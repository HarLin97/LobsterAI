import type {
  InstalledKitRecord,
  KitSkillMetadata,
} from '../../shared/kit/constants';
import {
  SkinPackKitBundle,
  SkinPackKitId,
  SkinPackKitMetadata,
  SkinPackSkillId,
} from '../../shared/skin/kit';

const SKIN_CREATOR_SKILL_METADATA: KitSkillMetadata = {
  id: SkinPackSkillId.BuiltIn,
  name: {
    en: 'AI Skin Creator',
    zh: 'AI 皮肤设计师',
  },
  description: {
    en: 'Creates and applies a coordinated LobsterAI backdrop and home emblem.',
    zh: '生成并应用一套协调的 LobsterAI 背景图与首页徽记。',
  },
};

export function buildSkinPackMarketplaceKit(): Record<string, unknown> {
  return {
    id: SkinPackKitId.BuiltIn,
    name: {
      en: 'AI Skin Designer',
      zh: 'AI 皮肤设计师',
    },
    description: {
      en: 'Turn a style idea into a LobsterAI backdrop and home emblem, then apply the skin.',
      zh: '把风格想法生成 LobsterAI 背景图与首页徽记，并自动应用皮肤。',
    },
    icon: SkinPackKitMetadata.IconUrl,
    author: 'LobsterAI',
    version: SkinPackKitMetadata.Version,
    workflowKind: SkinPackKitMetadata.WorkflowKind,
    tryAsking: [
      {
        en: 'Create a warm retro-futurist skin with amber light and calm geometric forms',
        zh: '生成一套暖色复古未来主义皮肤，使用琥珀光和克制的几何形态',
      },
      {
        en: 'Design a quiet deep-ocean skin in dark blue with bioluminescent accents',
        zh: '设计一套深蓝色的静谧深海皮肤，带少量生物荧光点缀',
      },
    ],
    skills: {
      bundle: SkinPackKitBundle.BuiltIn,
      list: [SKIN_CREATOR_SKILL_METADATA],
    },
    mcpServers: [],
    connectors: [],
  };
}

export function buildInstalledSkinPackKitRecord(): InstalledKitRecord {
  return {
    id: SkinPackKitId.BuiltIn,
    version: SkinPackKitMetadata.Version,
    installedAt: Date.now(),
    workflowKind: SkinPackKitMetadata.WorkflowKind,
    skills: {
      skillIds: [SkinPackSkillId.BuiltIn],
      metadata: {
        [SkinPackSkillId.BuiltIn]: SKIN_CREATOR_SKILL_METADATA,
      },
    },
    mcpServers: [],
    connectors: [],
  };
}
