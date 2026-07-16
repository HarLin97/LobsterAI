import { describe, expect, test } from 'vitest';

import { SkinWorkflowKind } from '../../shared/skin/constants';
import {
  SkinPackKitBundle,
  SkinPackKitId,
  SkinPackKitMetadata,
  SkinPackSkillId,
} from '../../shared/skin/kit';
import {
  buildInstalledSkinPackKitRecord,
  buildSkinPackMarketplaceKit,
} from './skinPackKit';

describe('AI Skin Designer built-in kit', () => {
  test('publishes only the bundled skin creator skill', () => {
    const kit = buildSkinPackMarketplaceKit() as {
      id: string;
      icon: string;
      version: string;
      workflowKind: string;
      skills: { bundle: string; list: Array<{ id: string }> };
      mcpServers: unknown[];
      connectors: unknown[];
    };

    expect(kit).toMatchObject({
      id: SkinPackKitId.BuiltIn,
      icon: SkinPackKitMetadata.IconUrl,
      version: SkinPackKitMetadata.Version,
      workflowKind: SkinWorkflowKind.SkinPack,
      skills: {
        bundle: SkinPackKitBundle.BuiltIn,
        list: [{ id: SkinPackSkillId.BuiltIn }],
      },
      mcpServers: [],
      connectors: [],
    });
    expect(kit.skills.list).toHaveLength(1);
  });

  test('persists the trusted workflow marker with the fixed skill id', () => {
    const record = buildInstalledSkinPackKitRecord();

    expect(record).toMatchObject({
      id: SkinPackKitId.BuiltIn,
      version: SkinPackKitMetadata.Version,
      workflowKind: SkinWorkflowKind.SkinPack,
      skills: {
        skillIds: [SkinPackSkillId.BuiltIn],
      },
      mcpServers: [],
      connectors: [],
    });
  });
});
