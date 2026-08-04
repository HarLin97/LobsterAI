import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import {
  buildAnthropicReplayPolicyForModel,
  buildGoogleGeminiReplayPolicy,
  buildOpenAICompatibleReplayPolicy,
} from 'openclaw/plugin-sdk/provider-model-shared';
import { createMoonshotKimiK3Wrapper } from 'openclaw/plugin-sdk/provider-stream-shared';

import {
  hasModelRuntimeProfile,
  LobsterAIModelRuntimeProfile,
  ModelProfileTransportDecision,
  parseModelProfileMap,
  resolveModelProfileTransportDecision,
} from './profileMapping';

const PLUGIN_ID = 'lobsterai-model-compat';
const OPENAI_COMPLETIONS_API = 'openai-completions';
const OPENAI_COMPATIBLE_APIS = new Set([
  OPENAI_COMPLETIONS_API,
  'openai-responses',
  'openai-chatgpt-responses',
]);

const register = (api: OpenClawPluginApi): void => {
  const modelProfiles = parseModelProfileMap(api.pluginConfig?.modelProfiles);
  const isKimiK3Profile = (provider: string, modelId: string): boolean => (
    hasModelRuntimeProfile(
      modelProfiles,
      provider,
      modelId,
      LobsterAIModelRuntimeProfile.MoonshotKimiK3,
    )
  );
  const resolveTransportDecision = (
    provider: string,
    modelId: string,
    modelApi?: string,
  ) => resolveModelProfileTransportDecision({
    modelProfiles,
    provider,
    modelId,
    modelApi,
  });
  const assertSupportedTransport = (
    provider: string,
    modelId: string,
    modelApi?: string,
  ): ReturnType<typeof resolveTransportDecision> => {
    const decision = resolveTransportDecision(provider, modelId, modelApi);
    if (decision.kind === ModelProfileTransportDecision.Reject) {
      throw new Error(
        `Kimi K3 compatibility requires ${decision.expectedApi} for ${provider}/${modelId}; received ${decision.actualApi}`,
      );
    }
    return decision;
  };

  api.registerProvider({
    id: PLUGIN_ID,
    label: 'LobsterAI Model Compatibility',
    hookAliases: ['lobsterai-server'],
    auth: [],
    buildReplayPolicy: (ctx) => {
      const modelApi = ctx.modelApi ?? ctx.model?.api;
      const modelId = ctx.modelId ?? '';
      const decision = assertSupportedTransport(ctx.provider, modelId, modelApi);
      if (decision.kind === ModelProfileTransportDecision.MoonshotKimiK3) {
        return buildOpenAICompatibleReplayPolicy(modelApi, {
          modelId,
          sanitizeToolCallIds: false,
          dropReasoningFromHistory: false,
        });
      }
      if (modelApi && OPENAI_COMPATIBLE_APIS.has(modelApi)) {
        return buildOpenAICompatibleReplayPolicy(modelApi, {
          modelId,
          dropReasoningFromHistory: ctx.model?.reasoning !== true,
        });
      }
      if (modelApi === 'anthropic-messages') {
        return buildAnthropicReplayPolicyForModel(modelId);
      }
      if (modelApi === 'google-generative-ai') {
        return buildGoogleGeminiReplayPolicy();
      }
      return undefined;
    },
    wrapStreamFn: (ctx) => {
      const decision = assertSupportedTransport(ctx.provider, ctx.modelId, ctx.model?.api);
      if (decision.kind === ModelProfileTransportDecision.Passthrough) {
        return ctx.streamFn;
      }
      return createMoonshotKimiK3Wrapper(ctx.streamFn);
    },
    resolveThinkingProfile: ({ provider, modelId }) => (
      isKimiK3Profile(provider, modelId)
        ? {
            levels: [{ id: 'max', label: 'max' }],
            defaultLevel: 'max',
            preserveWhenCatalogReasoningFalse: true,
          }
        : undefined
    ),
    isModernModelRef: ({ provider, modelId }) => (
      isKimiK3Profile(provider, modelId) || undefined
    ),
  });
};

export default {
  id: PLUGIN_ID,
  name: 'LobsterAI Model Compatibility',
  description: 'Applies explicit LobsterAI-managed model runtime profiles.',
  register,
};
