import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requestTimeout } from '../timeout.js';

describe('requestTimeout middleware', () => {
  it('does not interfere with fast responses', async () => {
    const app = express();
    app.use(requestTimeout(5000));
    app.get('/fast', (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).get('/fast');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('sends 504 when handler exceeds timeout', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.requestId = 'test-id';
      next();
    });
    app.use(requestTimeout(50)); // 50ms timeout for test speed
    app.get('/slow', (_req, res) => {
      // Respond after 200ms — will exceed 50ms timeout
      setTimeout(() => {
        if (!res.headersSent) {
          res.json({ ok: true });
        }
      }, 200);
    });

    const res = await request(app).get('/slow');
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('GATEWAY_TIMEOUT');
    expect(res.body.error.requestId).toBe('test-id');
  });

  it('includes requestId in timeout response', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.requestId = 'req-abc';
      next();
    });
    app.use(requestTimeout(30));
    app.get('/hang', () => {
      // Never responds
    });

    const res = await request(app).get('/hang');
    expect(res.status).toBe(504);
    expect(res.body.error.requestId).toBe('req-abc');
  });
});
