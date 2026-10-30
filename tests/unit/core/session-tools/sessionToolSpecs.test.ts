import { decodeSessionToolCall, SESSION_TOOL_SPECS } from '@/core/session-tools/sessionToolSpecs';
import { SESSION_TOOLS } from '@/core/tools/toolNames';

describe('session tool specs', () => {
  it('describe the tools with closed JSON Schema inputs and the optional-reply guidance', () => {
    expect(SESSION_TOOL_SPECS.map(spec => spec.name)).toEqual([...SESSION_TOOLS]);
    for (const spec of SESSION_TOOL_SPECS) {
      expect(spec.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    const send = SESSION_TOOL_SPECS.find(spec => spec.name === 'scribe_send_message')!;
    // Text is optional only for an interrupt that just stops; decoding enforces that.
    expect(send.inputSchema.required).toBeUndefined();
    expect(Object.keys(send.inputSchema.properties)).toEqual(['sessionId', 'text', 'mode', 'provider', 'model', 'reasoning']);
    for (const mode of ['"queue"', '"steer"', '"interrupt"']) expect(send.inputSchema.properties.mode?.description).toContain(mode);
    expect(send.description).toContain('<session_message');
    expect(send.description).toMatch(/only if a response is needed/);
    // Explicit new-session choices point at the listing instead of embedding a stale option list.
    for (const key of ['model', 'reasoning']) {
      expect(send.inputSchema.properties[key]?.description).toMatch(/switches that session's selection, which persists/);
    }
    for (const key of ['provider', 'model', 'reasoning']) {
      expect(send.inputSchema.properties[key]?.description).toContain('scribe_list_destinations with includeProviders: true');
    }
    const list = SESSION_TOOL_SPECS.find(spec => spec.name === 'scribe_list_destinations')!;
    expect(list.inputSchema.properties).toEqual({
      includeProviders: expect.objectContaining({ type: 'boolean' }),
      limit: expect.objectContaining({ type: 'integer' }),
      project: expect.objectContaining({ type: 'boolean' }),
    });
    expect(list.inputSchema.required).toBeUndefined();
    // The caller can recognize its own row, and a send result names its recipient.
    expect(list.description).toMatch(/self[^.]*calling session/);
    expect(send.description).toContain('{sessionId, title, provider, status}');
    const read = SESSION_TOOL_SPECS.find(spec => spec.name === 'scribe_read_session')!;
    expect(read.inputSchema.required).toEqual(['sessionId']);
    expect(Object.keys(read.inputSchema.properties)).toEqual(['sessionId', 'beforeTurn']);
    // Mentions carry only the id, so the reader must learn where the id comes from and how to page back.
    expect(read.description).toContain('<context_session');
    expect(read.description).toMatch(/fromTurn[^.]*as beforeTurn/);
  });
});

describe('decodeSessionToolCall', () => {
  it.each([
    ['list with no arguments', 'scribe_list_destinations', undefined,
      { tool: 'scribe_list_destinations', args: { includeProviders: false, limit: 50 } }],
    ['list with empty arguments', 'scribe_list_destinations', {},
      { tool: 'scribe_list_destinations', args: { includeProviders: false, limit: 50 } }],
    ['list with providers and a limit', 'scribe_list_destinations', { includeProviders: true, limit: 200 },
      { tool: 'scribe_list_destinations', args: { includeProviders: true, limit: 200 } }],
    ['list treating null optionals as omitted', 'scribe_list_destinations', { includeProviders: null, limit: null, project: null },
      { tool: 'scribe_list_destinations', args: { includeProviders: false, limit: 50 } }],
    ['list scoped to the caller\'s project', 'scribe_list_destinations', { project: true },
      { tool: 'scribe_list_destinations', args: { includeProviders: false, limit: 50, project: true } }],
    ['list with an explicit unscoped project flag', 'scribe_list_destinations', { project: false },
      { tool: 'scribe_list_destinations', args: { includeProviders: false, limit: 50 } }],
    ['send to a session', 'scribe_send_message', { sessionId: 'conv-1', text: 'Hi' },
      { tool: 'scribe_send_message', args: { sessionId: 'conv-1', text: 'Hi' } }],
    ['send to a new session with provider and model', 'scribe_send_message',
      { text: 'Hi', provider: 'codex', model: 'gpt-5' },
      { tool: 'scribe_send_message', args: { text: 'Hi', provider: 'codex', model: 'gpt-5' } }],
    ['send switching an existing session\'s model and reasoning', 'scribe_send_message',
      { sessionId: 'conv-1', text: 'Hi', model: 'gpt-5', reasoning: 'low' },
      { tool: 'scribe_send_message', args: { sessionId: 'conv-1', text: 'Hi', model: 'gpt-5', reasoning: 'low' } }],
    ['send to a new session with model and reasoning', 'scribe_send_message',
      { text: 'Hi', model: 'gpt-5', reasoning: 'low' },
      { tool: 'scribe_send_message', args: { text: 'Hi', model: 'gpt-5', reasoning: 'low' } }],
    ['send treating null optionals as omitted', 'scribe_send_message',
      { sessionId: null, text: 'Hi', provider: null, model: null, reasoning: null },
      { tool: 'scribe_send_message', args: { text: 'Hi' } }],
    ['read the latest turns', 'scribe_read_session', { sessionId: 'conv-1', beforeTurn: null },
      { tool: 'scribe_read_session', args: { sessionId: 'conv-1' } }],
    ['read earlier turns', 'scribe_read_session', { sessionId: 'conv-1', beforeTurn: 4 },
      { tool: 'scribe_read_session', args: { sessionId: 'conv-1', beforeTurn: 4 } }],
    ['a queue send as the default mode', 'scribe_send_message', { sessionId: 'conv-1', text: 'Hi', mode: 'queue' },
      { tool: 'scribe_send_message', args: { sessionId: 'conv-1', text: 'Hi' } }],
    ['a steer', 'scribe_send_message', { sessionId: 'conv-1', text: 'Also check X', mode: 'steer' },
      { tool: 'scribe_send_message', args: { sessionId: 'conv-1', text: 'Also check X', mode: 'steer' } }],
    ['an interrupt with a message and a switch', 'scribe_send_message',
      { sessionId: 'conv-1', text: 'Do Y instead', mode: 'interrupt', model: 'm', reasoning: 'low' },
      { tool: 'scribe_send_message', args: { sessionId: 'conv-1', text: 'Do Y instead', mode: 'interrupt', model: 'm', reasoning: 'low' } }],
    ['an interrupt that only stops', 'scribe_send_message', { sessionId: 'conv-1', mode: 'interrupt', text: null },
      { tool: 'scribe_send_message', args: { sessionId: 'conv-1', mode: 'interrupt' } }],
  ])('decodes %s', (_label, name, args, call) => {
    expect(decodeSessionToolCall(name, args)).toEqual({ ok: true, call });
  });

  it.each([
    ['an unknown tool', 'send_message', { text: 'Hi' }, /unknown session tool/i],
    ['non-object arguments', 'scribe_send_message', '{"text":"Hi"}', /arguments must be an object/i],
    ['array arguments', 'scribe_list_destinations', [], /arguments must be an object/i],
    ['unexpected list arguments', 'scribe_list_destinations', { sessionId: 'x' }, /unexpected argument "sessionId"/i],
    ['a non-boolean includeProviders', 'scribe_list_destinations', { includeProviders: 'true' }, /"includeProviders" must be a boolean/],
    ['a zero limit', 'scribe_list_destinations', { limit: 0 }, /"limit" must be an integer from 1 to 200/],
    ['an oversized limit', 'scribe_list_destinations', { limit: 201 }, /"limit" must be an integer from 1 to 200/],
    ['a fractional limit', 'scribe_list_destinations', { limit: 2.5 }, /"limit" must be an integer from 1 to 200/],
    ['a string limit', 'scribe_list_destinations', { limit: '10' }, /"limit" must be an integer from 1 to 200/],
    ['a non-boolean project', 'scribe_list_destinations', { project: 'true' }, /"project" must be a boolean/],
    ['a numeric project', 'scribe_list_destinations', { project: 1 }, /"project" must be a boolean/],
    ['unexpected send arguments', 'scribe_send_message', { text: 'Hi', to: 'x' }, /unexpected argument "to"/i],
    ['missing text', 'scribe_send_message', { sessionId: 'conv-1' }, /"text" must be a non-empty string/],
    ['blank text', 'scribe_send_message', { text: '  \n' }, /"text" must be a non-empty string/],
    ['a non-string session id', 'scribe_send_message', { sessionId: 7, text: 'Hi' }, /"sessionId" must be a non-empty string/],
    ['an empty provider', 'scribe_send_message', { text: 'Hi', provider: '' }, /"provider" must be a non-empty string/],
    ['provider for an existing session', 'scribe_send_message', { sessionId: 'conv-1', text: 'Hi', provider: 'codex' },
      /"provider" applies only when "sessionId" is omitted/],
    ['provider with model for an existing session', 'scribe_send_message',
      { sessionId: 'conv-1', text: 'Hi', provider: 'claude', model: 'm' }, /"provider" applies only when "sessionId" is omitted/],
    ['an empty reasoning', 'scribe_send_message', { text: 'Hi', reasoning: ' ' }, /"reasoning" must be a non-empty string/],
    ['a provider without a model', 'scribe_send_message', { text: 'Hi', provider: 'codex' }, /"provider" requires "model"/],
    ['a provider with only reasoning', 'scribe_send_message', { text: 'Hi', provider: 'codex', reasoning: 'high' }, /"provider" requires "model"/],
    ['a read without a session', 'scribe_read_session', {}, /"sessionId" must be a non-empty string/],
    ['a read with a blank session', 'scribe_read_session', { sessionId: ' ' }, /"sessionId" must be a non-empty string/],
    ['a read before turn zero', 'scribe_read_session', { sessionId: 'conv-1', beforeTurn: 0 }, /"beforeTurn" must be a positive integer/],
    ['a fractional beforeTurn', 'scribe_read_session', { sessionId: 'conv-1', beforeTurn: 1.5 }, /"beforeTurn" must be a positive integer/],
    ['unexpected read arguments', 'scribe_read_session', { sessionId: 'conv-1', limit: 3 }, /unexpected argument "limit"/i],
    ['an unknown mode', 'scribe_send_message', { sessionId: 'conv-1', text: 'Hi', mode: 'now' }, /"mode" must be "queue", "steer" or "interrupt"/],
    ['a steer without text', 'scribe_send_message', { sessionId: 'conv-1', mode: 'steer' }, /"text" must be a non-empty string/],
    ['a blank interrupt text', 'scribe_send_message', { sessionId: 'conv-1', mode: 'interrupt', text: ' ' }, /"text" must be a non-empty string/],
    ['a steer to a new session', 'scribe_send_message', { text: 'Hi', mode: 'steer' }, /"steer" and "interrupt" need "sessionId"/],
    ['an interrupt of a new session', 'scribe_send_message', { mode: 'interrupt' }, /"steer" and "interrupt" need "sessionId"/],
    ['a steer with a model switch', 'scribe_send_message', { sessionId: 'conv-1', text: 'Hi', mode: 'steer', model: 'm' },
      /"model" and "reasoning" cannot be used with "steer"/],
    ['a stop-only interrupt with a reasoning switch', 'scribe_send_message', { sessionId: 'conv-1', mode: 'interrupt', reasoning: 'low' },
      /"model" and "reasoning" need "text"/],
  ])('rejects %s', (_label, name, args, error) => {
    const result = decodeSessionToolCall(name, args);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(error);
  });
});
