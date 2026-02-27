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

  it('suppresses late res.json() after timeout without crashing', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.requestId = 'late-resp';
      next();
    });
    app.use(requestTimeout(50));
    app.get('/late', (_req, res) => {
      // Handler responds AFTER timeout — should not crash
      setTimeout(() => {
        res.json({ ok: true }); // No headersSent check — relies on middleware guard
      }, 200);
    });

    const res = await request(app).get('/late');
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('GATEWAY_TIMEOUT');
    // If we got here without "Cannot set headers" crash, the guard works
  });

  it('sets res.locals.timedOut flag after timeout', async () => {
    let timedOutValue: boolean | undefined;
    const app = express();
    app.use(requestTimeout(30));
    app.get('/check-flag', (_req, res) => {
      setTimeout(() => {
        timedOutValue = res.locals.timedOut;
      }, 100);
    });

    await request(app).get('/check-flag');
    // Wait for the handler's setTimeout to capture the flag
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(timedOutValue).toBe(true);
  });
});
