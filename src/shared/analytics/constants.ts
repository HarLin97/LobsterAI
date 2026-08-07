export const LogReporterEndpoint = {
  YoudaoAnalyzer: 'https://rlogs.youdao.com/rlog.php',
} as const;

export const LogReporterProduct = {
  LobsterAI: 'wisdom',
} as const;

export const LogReporterCategory = {
  Actions: 'actions',
} as const;

export const LogReporterActionPrefix = {
  LobsterAI: 'lobsterai_',
} as const;

export const LogReporterAction = {
  AgentCreateAction: 'lobsterai_agent_create_action',
  AgentSettingsAction: 'lobsterai_agent_settings_action',
  AgentEngineMaintenanceAction: 'lobsterai_agent_engine_maintenance_action',
  AgentEngineSettingChanged: 'lobsterai_agent_engine_setting_changed',
  AboutAction: 'lobsterai_about_action',
  AccountMenuAction: 'lobsterai_account_menu_action',
  AppStarted: 'lobsterai_app_started',
  AppearanceSettingChanged: 'lobsterai_appearance_setting_changed',
  ArtifactPreviewAction: 'lobsterai_artifact_preview_action',
  ActivityClaimClick: 'lobsterai_activity_claim_click',
  ActivityClaimFail: 'lobsterai_activity_claim_fail',
  ActivityClaimSuccess: 'lobsterai_activity_claim_success',
  ActivityEntryClick: 'lobsterai_activity_entry_click',
  ActivityLoginRedirect: 'lobsterai_activity_login_redirect',
  ActivityLoginSuccess: 'lobsterai_activity_login_success',
  ActivityPopupClose: 'lobsterai_activity_popup_close',
  ActivityPopupExposure: 'lobsterai_activity_popup_exposure',
  AuthLifecycle: 'lobsterai_auth_lifecycle',
  BrowserSettingChanged: 'lobsterai_browser_setting_changed',
  CustomModelConnectionTested: 'lobsterai_custom_model_connection_tested',
  CustomModelSettingsSaved: 'lobsterai_custom_model_settings_saved',
  ConversationBlockAction: 'lobsterai_conversation_block_action',
  ConversationMessageAction: 'lobsterai_conversation_message_action',
  ConversationNavigationAction: 'lobsterai_conversation_navigation_action',
  DreamingSettingChanged: 'lobsterai_dreaming_setting_changed',
  EmailSkillConnectionTested: 'lobsterai_email_skill_connection_tested',
  EmailSkillSettingsSaved: 'lobsterai_email_skill_settings_saved',
  ExpertKitAction: 'lobsterai_expert_kit_action',
  ExpertKitSelected: 'lobsterai_expert_kit_selected',
  GeneralSettingChanged: 'lobsterai_general_setting_changed',
  ImConnectionTested: 'lobsterai_im_connection_tested',
  ImGatewayToggled: 'lobsterai_im_gateway_toggled',
  ImInstanceChanged: 'lobsterai_im_instance_changed',
  ImPromptSubmit: 'lobsterai_im_prompt_submit',
  ImSettingsSaved: 'lobsterai_im_settings_saved',
  MemoryEntryChanged: 'lobsterai_memory_entry_changed',
  MemorySettingChanged: 'lobsterai_memory_setting_changed',
  McpEnabled: 'lobsterai_mcp_enabled',
  McpAction: 'lobsterai_mcp_action',
  ModelSelected: 'lobsterai_model_selected',
  PlanModeEnabled: 'lobsterai_plan_mode_enabled',
  PluginAction: 'lobsterai_plugin_action',
  PluginSettingsSaved: 'lobsterai_plugin_settings_saved',
  PromptControlAction: 'lobsterai_prompt_control_action',
  PromptSubmit: 'lobsterai_prompt_submit',
  PromptTemplateAction: 'lobsterai_prompt_template_action',
  ShortcutSettingChanged: 'lobsterai_shortcut_setting_changed',
  SidebarAction: 'lobsterai_sidebar_action',
  SkillAction: 'lobsterai_skill_action',
  SkillEnabled: 'lobsterai_skill_enabled',
  ScheduledTaskAction: 'lobsterai_scheduled_task_action',
  TaskSearchAction: 'lobsterai_task_search_action',
  UsageAnalyticsEnabled: 'lobsterai_usage_analytics_enabled',
} as const;

export type LogEventAction = `${typeof LogReporterActionPrefix.LobsterAI}${string}`;

export const LogReporterEntry = {
  PromptToolsMenu: 'prompt_tools_menu',
} as const;

export const LogReporterSource = {
  OpenClawChannel: 'openclaw_channel',
} as const;

export const PromptAnalyticsSurface = {
  Home: 'home',
  Conversation: 'conversation',
} as const;

export type PromptAnalyticsSurface =
  typeof PromptAnalyticsSurface[keyof typeof PromptAnalyticsSurface];

export const PromptAnalyticsConversationState = {
  NewTask: 'new_task',
  ContinueSession: 'continue_session',
} as const;

export type PromptAnalyticsConversationState =
  typeof PromptAnalyticsConversationState[keyof typeof PromptAnalyticsConversationState];

export const LogReporterStoreKey = {
  AppConfig: 'app_config',
  AuthUser: 'auth_user',
  InstallationUuid: 'installation_uuid',
} as const;
