import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock('../../services/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: vi.fn(() => 'abcdef12-3456-7890-abcd-ef1234567890'),
  };
});

import { requestLogger } from '../requestLogger.js';
import { logger } from '../../services/logger.js';

const mockLoggerInfo = logger.info as ReturnType<typeof vi.fn>;

// ── Helpers ─────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(requestLogger);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('requestLogger middleware', () => {
  it('generates an 8-char requestId from UUID', async () => {
    const app = createApp();
    app.get('/test', (req, res) => {
      res.json({ requestId: req.requestId });
    });

    const res = await request(app).get('/test');
    expect(res.body.requestId).toBe('abcdef12');
    expect(res.body.requestId).toHaveLength(8);
  });

  it('attaches requestId to req object', async () => {
    const app = createApp();
    let capturedId: string | undefined;
    app.get('/capture', (req, res) => {
      capturedId = req.requestId;
      res.sendStatus(200);
    });

    await request(app).get('/capture');
    expect(capturedId).toBe('abcdef12');
  });

  it('calls next() immediately', async () => {
    const app = createApp();
    const handlerReached = vi.fn();
    app.get('/next', (_req, res) => {
      handlerReached();
      res.sendStatus(200);
    });

    await request(app).get('/next');
    expect(handlerReached).toHaveBeenCalledOnce();
  });

  it('logs on response finish with method, path, status, and durationMs', async () => {
    const app = createApp();
    app.get('/api/test', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/api/test');

    expect(mockLoggerInfo).toHaveBeenCalledWith('request completed', {
      requestId: 'abcdef12',
      method: 'GET',
      path: '/api/test',
      status: 200,
      durationMs: expect.any(Number),
    });
  });

  it('logs correct status for error responses', async () => {
    const app = createApp();
    app.get('/fail', (_req, res) => {
      res.status(500).json({ error: 'internal' });
    });

    await request(app).get('/fail');

    expect(mockLoggerInfo).toHaveBeenCalledWith('request completed', expect.objectContaining({
      status: 500,
      method: 'GET',
      path: '/fail',
    }));
  });

  it('logs POST method correctly', async () => {
    const app = createApp();
    app.post('/submit', (_req, res) => {
      res.status(201).json({ created: true });
    });

    await request(app).post('/submit');

    expect(mockLoggerInfo).toHaveBeenCalledWith('request completed', expect.objectContaining({
      method: 'POST',
      status: 201,
    }));
  });

  it('durationMs is a non-negative number', async () => {
    const app = createApp();
    app.get('/timing', (_req, res) => {
      res.sendStatus(204);
    });

    await request(app).get('/timing');

    const logCall = mockLoggerInfo.mock.calls[0];
    expect(logCall[0]).toBe('request completed');
    expect(logCall[1].durationMs).toBeGreaterThanOrEqual(0);
  });
});
