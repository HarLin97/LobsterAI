import { APP_UPDATE_ELEVATION_DECLINED_ERROR } from '../../../shared/appUpdate/constants';
import { i18nService } from '../../services/i18n';

/**
 * Maps stable main-process error markers to localized text. Anything else is
 * an OS/network message shown as-is.
 */
export const formatAppUpdateError = (message: string): string =>
  message === APP_UPDATE_ELEVATION_DECLINED_ERROR
    ? i18nService.t('updateElevationDeclined')
    : message;
