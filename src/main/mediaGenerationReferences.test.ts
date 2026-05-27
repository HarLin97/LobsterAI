import { describe, expect, test } from 'vitest';

import {
  applyMediaReferencesToGenerationParams,
  MediaAttachmentKind,
  type MediaAttachmentRefMain,
  MediaAttachmentRole,
  MediaGenerationRequestType,
  summarizeMediaGenerationParamsForLog,
} from './mediaGenerationReferences';

const makeImageRef = (overrides: Partial<MediaAttachmentRefMain>): MediaAttachmentRefMain => ({
  token: overrides.token ?? '@图片2',
  mediaType: MediaAttachmentKind.Image,
  index: overrides.index ?? 2,
  fileId: overrides.fileId ?? '/tmp/second.png',
  fileName: overrides.fileName ?? 'second.png',
  mimeType: overrides.mimeType ?? 'image/png',
  localPath: overrides.localPath,
  remoteUrl: overrides.remoteUrl,
  dataUrl: overrides.dataUrl,
  role: overrides.role,
});

describe('applyMediaReferencesToGenerationParams', () => {
  test('puts explicit image mention first for video generation and treats it as first frame', () => {
    const params = applyMediaReferencesToGenerationParams({
      mediaType: MediaGenerationRequestType.Video,
      params: {
        images: ['/tmp/first.png'],
        imageRoles: [MediaAttachmentRole.ReferenceImage],
        firstFrame: '/tmp/first.png',
      },
      refs: [
        makeImageRef({
          localPath: '/tmp/second.png',
          role: MediaAttachmentRole.ReferenceImage,
        }),
      ],
    });

    expect(params.images).toEqual(['/tmp/second.png']);
    expect(params.imageRoles).toEqual([MediaAttachmentRole.FirstFrame]);
    expect(params.firstFrame).toBeUndefined();
  });

  test('keeps only explicit image mentions as image generation references', () => {
    const params = applyMediaReferencesToGenerationParams({
      mediaType: MediaGenerationRequestType.Image,
      params: {
        images: ['/tmp/first.png'],
        referenceImages: ['/tmp/first.png'],
        media: [{ type: 'reference_image', url: '/tmp/first.png' }],
        providerOptions: {
          media: [{ type: 'reference_image', url: '/tmp/first.png' }],
          prompt_optimizer: true,
        },
      },
      refs: [
        makeImageRef({
          localPath: '/tmp/second.png',
          role: MediaAttachmentRole.ReferenceImage,
        }),
      ],
    });

    expect(params.images).toEqual(['/tmp/second.png']);
    expect(params.imageRoles).toEqual([MediaAttachmentRole.ReferenceImage]);
    expect(params.referenceImages).toBeUndefined();
    expect(params.media).toBeUndefined();
    expect(params.providerOptions).toEqual({ prompt_optimizer: true });
  });
});

describe('summarizeMediaGenerationParamsForLog', () => {
  test('redacts data URL payloads in logged params', () => {
    const summary = summarizeMediaGenerationParamsForLog({
      images: ['data:image/png;base64,abc123'],
    });

    expect(summary).toEqual({
      images: ['[data-url:image/png,length=28]'],
    });
  });
});
