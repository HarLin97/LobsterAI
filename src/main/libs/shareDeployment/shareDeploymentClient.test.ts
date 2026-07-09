import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

import {
  buildNodeDeploymentClientSourceKey,
  buildStaticDeploymentClientSourceKey,
  clearDeploymentPersistenceData,
  downloadDeploymentPersistenceArchive,
  importDeploymentPersistenceData,
} from './shareDeploymentClient';

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeProjectDirectory(projectDirectory: string): string {
  return path.resolve(projectDirectory.trim()).replace(/\\/g, '/').toLowerCase();
}

describe('buildNodeDeploymentClientSourceKey', () => {
  test('uses a generic service deployment project key when project directory is available', () => {
    const firstPathKey = buildNodeDeploymentClientSourceKey({
      sessionId: 'session-1',
      localServiceUrl: 'http://localhost:3000/login',
      projectDirectory: '/Users/admin/project/fanren-vote',
    });
    const secondPathKey = buildNodeDeploymentClientSourceKey({
      sessionId: 'session-2',
      localServiceUrl: 'http://localhost:5173/dashboard',
      projectDirectory: '/Users/admin/project/fanren-vote/',
    });
    const otherProjectKey = buildNodeDeploymentClientSourceKey({
      sessionId: 'session-1',
      localServiceUrl: 'http://localhost:3000/login',
      projectDirectory: '/Users/admin/project/other-app',
    });

    expect(firstPathKey).toBe(secondPathKey);
    expect(firstPathKey).toBe(
      sha256(`service-deployment:v3:${normalizeProjectDirectory('/Users/admin/project/fanren-vote')}`),
    );
    expect(firstPathKey).not.toBe(otherProjectKey);
  });

  test('uses generic session and url key when project directory is unavailable', () => {
    const legacyKey = buildNodeDeploymentClientSourceKey({
      sessionId: 'session-1',
      localServiceUrl: 'http://localhost:3000/login',
    });
    const otherSessionKey = buildNodeDeploymentClientSourceKey({
      sessionId: 'session-2',
      localServiceUrl: 'http://localhost:3000/login',
    });
    const projectKey = buildNodeDeploymentClientSourceKey({
      sessionId: 'session-1',
      localServiceUrl: 'http://localhost:3000/login',
      projectDirectory: '/Users/admin/project/fanren-vote',
    });

    expect(legacyKey).toBe(sha256('service-deployment:session-1:http://localhost:3000/login'));
    expect(legacyKey).not.toBe(otherSessionKey);
    expect(legacyKey).not.toBe(projectKey);
  });
});

describe('buildStaticDeploymentClientSourceKey', () => {
  test('uses a static deployment project key when project directory is available', () => {
    const sourceKey = buildStaticDeploymentClientSourceKey({
      sessionId: 'session-1',
      localServiceUrl: 'http://localhost:3000/login',
      projectDirectory: '/Users/admin/project/fanren-vote',
    });

    expect(sourceKey).toBe(
      sha256(`service-deployment:static:v1:${normalizeProjectDirectory('/Users/admin/project/fanren-vote')}`),
    );
    expect(sourceKey).not.toBe(buildNodeDeploymentClientSourceKey({
      sessionId: 'session-1',
      localServiceUrl: 'http://localhost:3000/login',
      projectDirectory: '/Users/admin/project/fanren-vote',
    }));
  });
});

describe('deployment persistence data management client', () => {
  test('downloads, clears, and imports service data through deployment persistence APIs', async () => {
    const tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-persistence-client-test-'));
    const archivePath = path.join(tempDirectory, 'brotato-service-data.zip');
    await fs.promises.writeFile(archivePath, 'zip');

    try {
      const archiveContent = new Uint8Array([1, 2, 3, 4]);
      const downloadCalls: string[] = [];
      const downloadFetch = async (url: string): Promise<Response> => {
        downloadCalls.push(url);
        return new Response(archiveContent, { status: 200 });
      };

      const downloadResult = await downloadDeploymentPersistenceArchive(
        'https://server.test',
        downloadFetch,
        {
          deploymentId: 'dep_data',
          shareId: 'shr_data',
          projectDirectory: tempDirectory,
        },
      );

      expect(downloadResult.success).toBe(true);
      expect(downloadCalls).toEqual(['https://server.test/api/share-deployments/dep_data/persistence/archive']);
      expect(path.dirname(downloadResult.filePath ?? '')).toBe(
        path.join(tempDirectory, '.lobster', 'service-data-backups'),
      );
      expect(path.basename(downloadResult.filePath ?? '')).toMatch(/^shr_data-service-data-.*\.zip$/);
      expect(await fs.promises.readFile(downloadResult.filePath ?? '')).toEqual(Buffer.from(archiveContent));

      let clearRequest: RequestInit | undefined;
      const clearFetch = async (_url: string, options?: RequestInit): Promise<Response> => {
        clearRequest = options;
        return Response.json({
          code: 0,
          data: {
            enabled: true,
            provider: 'filesystem',
            usedBytes: 0,
            bindings: [],
          },
        });
      };

      const clearResult = await clearDeploymentPersistenceData(
        'https://server.test',
        clearFetch,
        {
          deploymentId: 'dep_data',
          confirmText: '清空线上数据',
        },
      );

      expect(clearResult.success).toBe(true);
      expect(clearRequest?.method).toBe('POST');
      expect(clearRequest?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(clearRequest?.body as string)).toEqual({ confirmText: '清空线上数据' });

      let importRequest: RequestInit | undefined;
      const importFetch = async (_url: string, options?: RequestInit): Promise<Response> => {
        importRequest = options;
        return Response.json({
          code: 0,
          data: {
            enabled: true,
            provider: 'filesystem',
            usedBytes: 3,
            bindings: [{ appPath: 'data', dataPath: 'data', kind: 'directory' }],
          },
        });
      };

      const importResult = await importDeploymentPersistenceData(
        'https://server.test',
        importFetch,
        {
          deploymentId: 'dep_data',
          archivePath,
          confirmText: '替换线上数据',
        },
      );

      expect(importResult.success).toBe(true);
      expect(importRequest?.method).toBe('POST');
      expect(importRequest?.body).toBeInstanceOf(FormData);
      const form = importRequest?.body as FormData;
      expect(form.get('confirmText')).toBe('替换线上数据');
      expect((form.get('archive') as File).name).toBe('brotato-service-data.zip');
    } finally {
      await fs.promises.rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
