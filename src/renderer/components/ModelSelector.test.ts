import { ModelThinkingLevel } from '@shared/providers/modelThinking';
import { expect, test } from 'vitest';

import {
  canConfigureModelThinking,
  CascadeSide,
  isModelAgenticBlocked,
  resolveCascadePlacement,
  resolveDropdownListMaxHeight,
  resolveHoverCardTop,
  resolvePickerThinkingLevel,
} from './ModelSelector';

test('keeps model hover card above the viewport bottom', () => {
  expect(resolveHoverCardTop(790, 260, 900)).toBe(632);
});

test('keeps model hover card below the viewport top margin', () => {
  expect(resolveHoverCardTop(-20, 120, 900)).toBe(8);
});

test('does not move a fully visible model hover card', () => {
  expect(resolveHoverCardTop(240, 180, 900)).toBe(240);
});

test('pins model hover card to the margin when it is taller than the viewport', () => {
  expect(resolveHoverCardTop(160, 1000, 900)).toBe(8);
});

test('places a cascaded popover flush against its anchor, without gap or overlap', () => {
  expect(resolveCascadePlacement({
    anchorLeft: 400,
    anchorRight: 700,
    width: 220,
    viewportWidth: 1200,
    preferredSide: CascadeSide.Right,
  })).toEqual({ left: 700, side: CascadeSide.Right });
});

test('flips a cascaded popover to the left when the right side does not fit', () => {
  expect(resolveCascadePlacement({
    anchorLeft: 700,
    anchorRight: 1000,
    width: 220,
    viewportWidth: 1100,
    preferredSide: CascadeSide.Right,
  })).toEqual({ left: 480, side: CascadeSide.Left });
});

test('keeps cascading towards the side the previous popover took', () => {
  expect(resolveCascadePlacement({
    anchorLeft: 300,
    anchorRight: 520,
    width: 210,
    viewportWidth: 1100,
    preferredSide: CascadeSide.Left,
  })).toEqual({ left: 90, side: CascadeSide.Left });
});

test('falls back to the opposite side when the preferred side has no room', () => {
  expect(resolveCascadePlacement({
    anchorLeft: 40,
    anchorRight: 260,
    width: 210,
    viewportWidth: 1100,
    preferredSide: CascadeSide.Left,
  })).toEqual({ left: 260, side: CascadeSide.Right });
});

test('clamps a cascaded popover inside the viewport when neither side fits', () => {
  expect(resolveCascadePlacement({
    anchorLeft: 20,
    anchorRight: 260,
    width: 210,
    viewportWidth: 280,
    preferredSide: CascadeSide.Right,
  })).toEqual({ left: 62, side: CascadeSide.Right });
});

test('caps the model list at its default height when space allows', () => {
  expect(resolveDropdownListMaxHeight(600, true, true)).toBe(288);
});

test('shrinks the model list so group tabs and footer stay visible in short windows', () => {
  // 341px available minus tabs (49) + footer (33) + borders (2)
  expect(resolveDropdownListMaxHeight(341, true, true)).toBe(257);
});

test('keeps at least three model rows visible when space is extremely tight', () => {
  expect(resolveDropdownListMaxHeight(50, true, true)).toBe(116);
});

test('uses the full available space when tabs and footer are hidden', () => {
  expect(resolveDropdownListMaxHeight(200, false, false)).toBe(198);
});

const THINKING_CONFIG = {
  options: [
    { level: ModelThinkingLevel.Off, openclawLevel: 'off' as const },
    { level: ModelThinkingLevel.High, openclawLevel: 'high' as const },
    { level: ModelThinkingLevel.Max, openclawLevel: 'xhigh' as const },
  ],
  defaultLevel: ModelThinkingLevel.High,
};

test('shows the level the user is picking right now', () => {
  expect(resolvePickerThinkingLevel({
    config: THINKING_CONFIG,
    requestedLevel: ModelThinkingLevel.Max,
    selectedModelLevel: ModelThinkingLevel.Off,
    rememberedLevel: ModelThinkingLevel.High,
  })).toBe(ModelThinkingLevel.Max);
});

test('shows the persisted level for the model that is actually selected', () => {
  expect(resolvePickerThinkingLevel({
    config: THINKING_CONFIG,
    selectedModelLevel: ModelThinkingLevel.Max,
    rememberedLevel: ModelThinkingLevel.High,
  })).toBe(ModelThinkingLevel.Max);
});

test('keeps each unselected model on its own remembered level', () => {
  expect(resolvePickerThinkingLevel({
    config: THINKING_CONFIG,
    rememberedLevel: ModelThinkingLevel.Max,
  })).toBe(ModelThinkingLevel.Max);
  expect(resolvePickerThinkingLevel({
    config: THINKING_CONFIG,
    selectedModelLevel: null,
    rememberedLevel: ModelThinkingLevel.Off,
  })).toBe(ModelThinkingLevel.Off);
});

test('falls back to the model default when nothing was picked before', () => {
  expect(resolvePickerThinkingLevel({ config: THINKING_CONFIG })).toBe(ModelThinkingLevel.High);
});

test('ignores levels the model does not offer', () => {
  expect(resolvePickerThinkingLevel({
    config: THINKING_CONFIG,
    requestedLevel: ModelThinkingLevel.Minimal,
    rememberedLevel: ModelThinkingLevel.Low,
  })).toBe(ModelThinkingLevel.High);
});

test('blocks only explicitly unready server models from agent selection', () => {
  expect(isModelAgenticBlocked({
    isServerModel: true,
    runtimeProfile: 'moonshot-kimi-k3',
    agenticReady: false,
  })).toBe(true);
  expect(isModelAgenticBlocked({
    isServerModel: true,
    runtimeProfile: 'moonshot-kimi-k3',
  })).toBe(true);
  expect(isModelAgenticBlocked({
    isServerModel: true,
    runtimeProfile: 'moonshot-kimi-k3',
    agenticReady: true,
  })).toBe(false);
  expect(isModelAgenticBlocked({
    isServerModel: true,
    agenticReady: false,
  })).toBe(false);
  expect(isModelAgenticBlocked({
    isServerModel: false,
    runtimeProfile: 'moonshot-kimi-k3',
    agenticReady: false,
  })).toBe(false);
});

test('allows thinking changes only for accessible and ready models', () => {
  const thinkingConfig = {
    options: [
      { level: 'off' as const, openclawLevel: 'off' as const },
      { level: 'high' as const, openclawLevel: 'high' as const },
      { level: 'max' as const, openclawLevel: 'xhigh' as const },
    ],
    defaultLevel: 'high' as const,
  };
  expect(canConfigureModelThinking({
    accessible: true,
    isServerModel: true,
    thinkingConfig: { options: thinkingConfig.options.map(option => ({ ...option })), defaultLevel: thinkingConfig.defaultLevel },
  })).toBe(true);
  expect(canConfigureModelThinking({
    accessible: false,
    isServerModel: true,
    thinkingConfig: { options: thinkingConfig.options.map(option => ({ ...option })), defaultLevel: thinkingConfig.defaultLevel },
  })).toBe(false);
  expect(canConfigureModelThinking({
    accessible: true,
    isServerModel: true,
    runtimeProfile: 'moonshot-kimi-k3',
    agenticReady: false,
    thinkingConfig: { options: thinkingConfig.options.map(option => ({ ...option })), defaultLevel: thinkingConfig.defaultLevel },
  })).toBe(false);
  expect(canConfigureModelThinking({
    accessible: true,
    isServerModel: true,
  })).toBe(false);
});
