import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsJobs } from "./metrics.jobs";

const CLINIC = "00000000-0000-0000-0000-0000000c1141";

describe("MetricsJobs (cron BE-3.4)", () => {
  let jobs: MetricsJobs;
  const prismaMock = {
    conversation: { updateMany: jest.fn(), count: jest.fn() },
    message: { count: jest.fn() },
    lead: { count: jest.fn() },
    appointment: { count: jest.fn() },
    clinic: { findMany: jest.fn() },
    dailyMetric: { upsert: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [MetricsJobs, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    jobs = moduleRef.get(MetricsJobs);
  });

  it("markAbandoned: em_andamento inativas → abandonada (por lastMessageAt)", async () => {
    prismaMock.conversation.updateMany.mockResolvedValueOnce({ count: 3 });

    const count = await jobs.markAbandoned();

    expect(count).toBe(3);
    const arg = prismaMock.conversation.updateMany.mock.calls[0][0];
    expect(arg.where.status).toBe("em_andamento");
    expect(arg.where.lastMessageAt.lt).toBeInstanceOf(Date);
    expect(arg.data).toEqual({ status: "abandonada" });
  });

  it("aggregateDaily: faz upsert de daily_metric por clínica para o dia anterior", async () => {
    prismaMock.clinic.findMany.mockResolvedValueOnce([{ id: CLINIC }]);
    prismaMock.message.count.mockResolvedValue(5); // bot e user
    prismaMock.lead.count.mockResolvedValueOnce(2);
    prismaMock.conversation.count.mockResolvedValueOnce(4);
    prismaMock.appointment.count.mockResolvedValueOnce(1);
    prismaMock.dailyMetric.upsert.mockResolvedValueOnce({});

    await jobs.aggregateDaily();

    expect(prismaMock.dailyMetric.upsert).toHaveBeenCalledTimes(1);
    const arg = prismaMock.dailyMetric.upsert.mock.calls[0][0];
    expect(arg.where.clinicId_date.clinicId).toBe(CLINIC);
    expect(arg.where.clinicId_date.date).toBeInstanceOf(Date);
    expect(arg.create).toMatchObject({
      clinicId: CLINIC,
      botMessages: 5,
      userMessages: 5,
      leads: 2,
      conversationsStarted: 4,
      conversationsScheduled: 1,
    });
  });
});
