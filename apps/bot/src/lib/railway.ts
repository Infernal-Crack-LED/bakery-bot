/**
 * Minimal Railway public-API client — just enough to read and rotate a
 * service's environment variables from a script.
 *
 * Auth is the project token in `RAILWAY_TOKEN` (golden rule 6: it lives in env,
 * never in code). A project token is scoped to ONE project + environment and
 * sends the `Project-Access-Token` header — not `Authorization: Bearer`, which
 * is for account tokens and answers "Not Authorized" here. Because the token
 * already names its project and environment, callers only have to name the
 * SERVICE, and even that is resolved by name (e.g. `@app/web`) so no uuid ends
 * up hardcoded.
 *
 * Note: upserting a variable stages a redeploy of the target service — Railway
 * restarts it to pick the new value up. That is fine for a monthly credential
 * rotation but makes this the wrong tool for anything high-frequency.
 */

const API = 'https://backboard.railway.com/graphql/v2';

type Fetch = typeof fetch;

export interface RailwayScope {
  projectId: string;
  environmentId: string;
}

/** A GraphQL error came back — carries the messages Railway reported. */
export class RailwayError extends Error {
  constructor(operation: string, messages: string[]) {
    super(`railway ${operation}: ${messages.join('; ') || 'unknown error'}`);
    this.name = 'RailwayError';
  }
}

async function gql<T>(
  token: string,
  operation: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: Fetch
): Promise<T> {
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Project-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new RailwayError(operation, [`HTTP ${res.status}`]);
  }
  const body = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (body.errors?.length) {
    throw new RailwayError(
      operation,
      body.errors.map((e) => e.message)
    );
  }
  if (!body.data) {
    throw new RailwayError(operation, ['no data']);
  }
  return body.data;
}

/** Resolve the project + environment the token itself is scoped to. */
export async function railwayScope(
  token: string,
  fetchImpl: Fetch = fetch
): Promise<RailwayScope> {
  const data = await gql<{ projectToken: RailwayScope }>(
    token,
    'projectToken',
    'query { projectToken { projectId environmentId } }',
    {},
    fetchImpl
  );
  return data.projectToken;
}

/** Look up a service id by its Railway service name (e.g. `@app/web`). */
export async function railwayServiceId(
  token: string,
  projectId: string,
  serviceName: string,
  fetchImpl: Fetch = fetch
): Promise<string> {
  const data = await gql<{
    project: { services: { edges: { node: { id: string; name: string } }[] } };
  }>(
    token,
    'project',
    'query($id:String!){ project(id:$id){ services { edges { node { id name } } } } }',
    { id: projectId },
    fetchImpl
  );
  const match = data.project.services.edges.find(
    (e) => e.node.name === serviceName
  );
  if (!match) {
    const names = data.project.services.edges.map((e) => e.node.name);
    throw new RailwayError('project', [
      `no service named "${serviceName}" (have: ${names.join(', ')})`,
    ]);
  }
  return match.node.id;
}

/** Read a service's variables (values included — treat as secrets). */
export async function railwayVariables(
  token: string,
  scope: RailwayScope,
  serviceId: string,
  fetchImpl: Fetch = fetch
): Promise<Record<string, string>> {
  const data = await gql<{ variables: Record<string, string> }>(
    token,
    'variables',
    'query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }',
    { p: scope.projectId, e: scope.environmentId, s: serviceId },
    fetchImpl
  );
  return data.variables ?? {};
}

/** Create or overwrite one variable on a service. */
export async function railwayUpsertVariable(
  token: string,
  scope: RailwayScope,
  serviceId: string,
  name: string,
  value: string,
  fetchImpl: Fetch = fetch
): Promise<void> {
  await gql(
    token,
    'variableUpsert',
    'mutation($input:VariableUpsertInput!){ variableUpsert(input:$input) }',
    {
      input: {
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        serviceId,
        name,
        value,
      },
    },
    fetchImpl
  );
}
