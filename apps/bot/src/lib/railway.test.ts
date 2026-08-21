import { describe, expect, it, vi } from 'vitest';
import {
  RailwayError,
  railwayScope,
  railwayServiceId,
  railwayUpsertVariable,
  railwayVariables,
} from './railway.js';

const TOKEN = 'proj-token';
const SCOPE = { projectId: 'proj-1', environmentId: 'env-1' };

function ok(data: unknown) {
  return vi.fn(() => Promise.resolve(Response.json({ data })));
}

describe('railwayScope', () => {
  it('reads the project + environment off the token itself', async () => {
    const fetchImpl = ok({ projectToken: SCOPE });

    expect(await railwayScope(TOKEN, fetchImpl as never)).toEqual(SCOPE);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://backboard.railway.com/graphql/v2');
    // A PROJECT token authenticates with this header — `Authorization: Bearer`
    // is for account tokens and answers "Not Authorized".
    expect(
      (init.headers as Record<string, string>)['Project-Access-Token']
    ).toBe(TOKEN);
  });
});

describe('railwayServiceId', () => {
  const project = {
    project: {
      services: {
        edges: [
          { node: { id: 'svc-web', name: '@app/web' } },
          { node: { id: 'svc-bot', name: '@app/bot' } },
        ],
      },
    },
  };

  it('resolves a service id by name', async () => {
    const id = await railwayServiceId(
      TOKEN,
      SCOPE.projectId,
      '@app/web',
      ok(project) as never
    );
    expect(id).toBe('svc-web');
  });

  it('lists the real names when the service is missing', async () => {
    await expect(
      railwayServiceId(TOKEN, SCOPE.projectId, '@app/api', ok(project) as never)
    ).rejects.toThrow(/no service named "@app\/api".*@app\/web/s);
  });
});

describe('railwayVariables', () => {
  it('returns the variable map', async () => {
    const fetchImpl = ok({ variables: { A: '1', B: '2' } });
    await expect(
      railwayVariables(TOKEN, SCOPE, 'svc-web', fetchImpl as never)
    ).resolves.toEqual({ A: '1', B: '2' });
  });

  it('surfaces GraphQL errors instead of returning empty', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({ errors: [{ message: 'Not Authorized' }] })
      )
    );
    await expect(
      railwayVariables(TOKEN, SCOPE, 'svc-web', fetchImpl as never)
    ).rejects.toThrow(RailwayError);
  });
});

describe('railwayUpsertVariable', () => {
  it('sends the scoped upsert input', async () => {
    const fetchImpl = ok({ variableUpsert: true });

    await railwayUpsertVariable(
      TOKEN,
      SCOPE,
      'svc-web',
      'BLABLALINK_GAME_TOKEN',
      'new-token',
      fetchImpl as never
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.variables.input).toEqual({
      projectId: 'proj-1',
      environmentId: 'env-1',
      serviceId: 'svc-web',
      name: 'BLABLALINK_GAME_TOKEN',
      value: 'new-token',
    });
  });

  it('throws on an HTTP failure', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('nope', { status: 500 }))
    );
    await expect(
      railwayUpsertVariable(
        TOKEN,
        SCOPE,
        'svc-web',
        'X',
        'y',
        fetchImpl as never
      )
    ).rejects.toThrow('HTTP 500');
  });
});
