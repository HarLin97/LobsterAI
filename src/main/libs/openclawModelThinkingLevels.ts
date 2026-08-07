import {
  OpenClawProviderId,
  parseModelThinkingLevel,
  resolveOpenClawThinkingLevel,
} from '../../shared/providers';
import { getServerModelMetadata } from './claudeSettings';

const LOBSTERAI_SERVER_MODEL_PREFIX = `${OpenClawProviderId.LobsteraiServer}/`;

export const resolveOpenClawThinkingLevelForModel = (
  modelRef: string,
  productLevel: string,
): string => {
  const normalizedModelRef = modelRef.trim();
  const normalizedProductLevel = parseModelThinkingLevel(productLevel);
  if (
    !normalizedProductLevel
    || !normalizedModelRef.startsWith(LOBSTERAI_SERVER_MODEL_PREFIX)
  ) {
    return productLevel;
  }

  const modelId = normalizedModelRef.slice(LOBSTERAI_SERVER_MODEL_PREFIX.length);
  const thinkingConfig = getServerModelMetadata(modelId)?.thinkingConfig;
  if (!thinkingConfig) return productLevel;

  return resolveOpenClawThinkingLevel(thinkingConfig, normalizedProductLevel) ?? productLevel;
};
