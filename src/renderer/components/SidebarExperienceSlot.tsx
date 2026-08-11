import React from 'react';

import SidebarAdBanner from './SidebarAdBanner';

interface SidebarExperienceSlotProps {
  hidden?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}

const SidebarExperienceSlot: React.FC<SidebarExperienceSlotProps> = ({
  hidden = false,
  onVisibleChange,
}) => (
  <SidebarAdBanner
    hidden={hidden}
    onVisibleChange={onVisibleChange}
  />
);

export default SidebarExperienceSlot;
