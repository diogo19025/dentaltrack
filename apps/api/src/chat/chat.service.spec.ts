import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";

// Mocka só a chamada de IA (sem rede), mantendo o AiUnavailableError real.
jest.mock("../ai/generate-reply", () => {
  const actual = jest.requireActual<typeof import("../ai/generate-reply")>("../ai/generate-reply");
  return { ...actual, generateAssistantReply: jest.fn() };
});
import { AiUnavailableError, generateAssistantReply } from "../ai/generate-reply";
import { ChatService } from "./chat.service";
import { ConversationsService } from "../conversations/conversations.service";
import { PrismaService } from "../prisma/prisma.service";

const generateMock = generateAssistantReply as jest.MockedFunction<typeof generateAssistantReply>;

const CLINIC_ID = "00000000-0000-0000-0000-0000000c1141";
const CONVERSATION_ID = "22222222-2222-2222-2222-222222222222";

function assistantRow(content: string) {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    role: "assistant",
    content,
    createdAt: new Date("2026-06-05T10:00:00.000Z"),
  };
}

describe("ChatService", () => {
  let service: ChatService;
  const conversationsMock = {
    createConversation: jest.fn(),
    appendMessage: jest.fn(),
    getConversation: jest.fn(),
  };
  const prismaMock = {
    conversation: { findUnique: jest.fn() },
    clinic: { findUnique: jest.fn(), findFirst: jest.fn() },
    clinicSettings: { findUnique: jest.fn() },
    procedure: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    generateMock.mockResolvedValue({ text: "Resposta da IA.", tokens: 42 });
    // Defaults para o buildPrompt (clínica existe, sem settings, sem procedimentos).
    prismaMock.clinic.findUnique.mockResolvedValue({
      id: CLINIC_ID,
      name: "Clínica Demo",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prismaMock.clinicSettings.findUnique.mockResolvedValue(null);
    prismaMock.procedure.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ConversationsService, useValue: conversationsMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
  });

  it("sem conversationId: abre conversa, persiste user, chama IA e persiste assistant", async () => {
    prismaMock.clinic.findFirst.mockResolvedValueOnce({ id: CLINIC_ID });
    conversationsMock.createConversation.mockResolvedValueOnce({ id: CONVERSATION_ID });
    conversationsMock.appendMessage
      .mockResolvedValueOnce({ id: "user-msg" }) // user
      .mockResolvedValueOnce(assistantRow("Resposta da IA.")); // assistant
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [{ role: "user", content: "Olá" }],
    });

    const res = await service.handleMessage({ message: "Olá" });

    expect(conversationsMock.createConversation).toHaveBeenCalledWith(CLINIC_ID);
    expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
      1,
      CONVERSATION_ID,
      "user",
      "Olá",
      {},
      CLINIC_ID,
    );
    // IA recebe o histórico (apenas user/assistant) + o system prompt da clínica + tools.
    expect(generateMock).toHaveBeenCalledWith(
      [{ role: "user", content: "Olá" }],
      expect.stringContaining("Clínica Demo"),
      expect.objectContaining({ captureLead: expect.anything(), bookAppointment: expect.anything() }),
    );
    // assistant é salvo com o texto da IA e os tokens usados.
    expect(conversationsMock.appendMessage).toHaveBeenNthCalledWith(
      2,
      CONVERSATION_ID,
      "assistant",
      "Resposta da IA.",
      { tokens: 42 },
      CLINIC_ID,
    );
    expect(res).toEqual({
      conversationId: CONVERSATION_ID,
      assistantMessage: {
        id: "33333333-3333-3333-3333-333333333333",
        role: "assistant",
        content: "Resposta da IA.",
        createdAt: "2026-06-05T10:00:00.000Z",
      },
    });
  });

  it("com conversationId: deriva clinicId da conversa e não cria nova", async () => {
    prismaMock.conversation.findUnique.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      clinicId: CLINIC_ID,
    });
    conversationsMock.appendMessage
      .mockResolvedValueOnce({ id: "user-msg" })
      .mockResolvedValueOnce(assistantRow("Oi de novo."));
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "Olá!" },
        { role: "user", content: "Oi" },
      ],
    });

    const res = await service.handleMessage({ conversationId: CONVERSATION_ID, message: "Oi" });

    expect(conversationsMock.createConversation).not.toHaveBeenCalled();
    expect(res.conversationId).toBe(CONVERSATION_ID);
  });

  it("filtra mensagens 'system' do histórico enviado à IA", async () => {
    prismaMock.clinic.findFirst.mockResolvedValueOnce({ id: CLINIC_ID });
    conversationsMock.createConversation.mockResolvedValueOnce({ id: CONVERSATION_ID });
    conversationsMock.appendMessage
      .mockResolvedValueOnce({ id: "user-msg" })
      .mockResolvedValueOnce(assistantRow("ok"));
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [
        { role: "system", content: "prompt interno" },
        { role: "user", content: "Olá" },
      ],
    });

    await service.handleMessage({ message: "Olá" });

    expect(generateMock).toHaveBeenCalledWith(
      [{ role: "user", content: "Olá" }],
      expect.any(String),
      expect.any(Object),
    );
  });

  it("falha da IA → 503 tratado, sem quebrar; user persistido, assistant não", async () => {
    prismaMock.clinic.findFirst.mockResolvedValueOnce({ id: CLINIC_ID });
    conversationsMock.createConversation.mockResolvedValueOnce({ id: CONVERSATION_ID });
    conversationsMock.appendMessage.mockResolvedValueOnce({ id: "user-msg" }); // só o user
    conversationsMock.getConversation.mockResolvedValueOnce({
      messages: [{ role: "user", content: "Olá" }],
    });
    generateMock.mockRejectedValueOnce(new AiUnavailableError(new Error("429 rate limit")));

    await expect(service.handleMessage({ message: "Olá" })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // user foi persistido; assistant NÃO (1 só chamada de appendMessage).
    expect(conversationsMock.appendMessage).toHaveBeenCalledTimes(1);
    expect(conversationsMock.appendMessage).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "user",
      "Olá",
      {},
      CLINIC_ID,
    );
  });

  it("conversationId inexistente → 404", async () => {
    prismaMock.conversation.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.handleMessage({ conversationId: CONVERSATION_ID, message: "Oi" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("clinicId informado divergente da conversa → 400", async () => {
    prismaMock.conversation.findUnique.mockResolvedValueOnce({
      id: CONVERSATION_ID,
      clinicId: CLINIC_ID,
    });
    await expect(
      service.handleMessage({
        conversationId: CONVERSATION_ID,
        message: "Oi",
        clinicId: "99999999-9999-9999-9999-999999999999",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("sem clínica cadastrada → 400 (orienta rodar o seed)", async () => {
    prismaMock.clinic.findFirst.mockResolvedValueOnce(null);
    await expect(service.handleMessage({ message: "Olá" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
