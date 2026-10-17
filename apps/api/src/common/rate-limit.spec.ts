import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import request from 'supertest';
import { CHAT_RATE_LIMIT, RateLimitModule } from './rate-limit';

type Server = Parameters<typeof request>[0];

/** Token sem assinatura válida: o tracker só lê o `sub` para escolher o balde. */
function bearer(sub: string): string {
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `Bearer ${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub })}.assinatura`;
}

@Controller()
class ProbeController {
  @Post('caro')
  @Throttle(CHAT_RATE_LIMIT)
  caro() {
    return { ok: true };
  }

  @Get('livre')
  @SkipThrottle()
  livre() {
    return { ok: true };
  }
}

describe('RateLimitModule (rate limit HTTP por usuário)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RateLimitModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rota cara: o 21º request do mesmo usuário no minuto recebe 429', async () => {
    const server = app.getHttpServer() as Server;
    for (let i = 0; i < CHAT_RATE_LIMIT.default.limit; i++) {
      await request(server)
        .post('/caro')
        .set('Authorization', bearer('usuario-a'))
        .expect(201);
    }

    const blocked = await request(server)
      .post('/caro')
      .set('Authorization', bearer('usuario-a'));

    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).toContain('Muitas requisições');
  });

  it('o balde é do usuário: outro usuário no mesmo IP continua passando', async () => {
    const server = app.getHttpServer() as Server;
    for (let i = 0; i <= CHAT_RATE_LIMIT.default.limit; i++) {
      await request(server)
        .post('/caro')
        .set('Authorization', bearer('usuario-a'));
    }

    await request(server)
      .post('/caro')
      .set('Authorization', bearer('usuario-b'))
      .expect(201);
  });

  it('rota isenta não conta', async () => {
    const server = app.getHttpServer() as Server;
    for (let i = 0; i < 30; i++) {
      await request(server).get('/livre').expect(200);
    }
  });
});
