import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../../services/i18n';
import EllipsisHorizontalIcon from '../icons/EllipsisHorizontalIcon';
import { MANAGEMENT_BODY_TEXT } from './managementTypography';

const MENU_WIDTH_PX = 152;
const MENU_EDGE_GAP_PX = 8;
const MENU_TRIGGER_GAP_PX = 4;
const MENU_ITEM_HEIGHT_PX = 36;

export interface CardOverflowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

interface CardOverflowMenuProps {
  items: CardOverflowMenuItem[];
  /** Extra classes for the trigger, e.g. to reveal it on card hover. */
  className?: string;
}

/**
 * Overflow menu for the low-frequency card actions (enable/disable, edit,
 * delete), keeping the card's own surface free for the one action people
 * actually reach for after installing something.
 */
const CardOverflowMenu: React.FC<CardOverflowMenuProps> = ({ items, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const menuHeight = items.length * MENU_ITEM_HEIGHT_PX + 8;

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - MENU_WIDTH_PX - MENU_EDGE_GAP_PX;
    const left = Math.max(MENU_EDGE_GAP_PX, Math.min(rect.right - MENU_WIDTH_PX, maxLeft));
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuHeight + MENU_TRIGGER_GAP_PX && rect.top > spaceBelow;
    const preferredTop = openAbove
      ? rect.top - menuHeight - MENU_TRIGGER_GAP_PX
      : rect.bottom + MENU_TRIGGER_GAP_PX;
    const maxTop = window.innerHeight - menuHeight - MENU_EDGE_GAP_PX;
    setPosition({
      top: Math.max(MENU_EDGE_GAP_PX, Math.min(preferredTop, maxTop)),
      left,
    });
  }, [menuHeight]);

  useLayoutEffect(() => {
    if (isOpen) updatePosition();
    else setPosition(null);
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const handleReflow = () => setIsOpen(false);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleReflow);
    window.addEventListener('scroll', handleReflow, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleReflow);
      window.removeEventListener('scroll', handleReflow, true);
    };
  }, [isOpen]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={i18nService.t('moreActions')}
        title={i18nService.t('moreActions')}
        onClick={(event) => { event.stopPropagation(); setIsOpen(value => !value); }}
        className={`inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-raised hover:text-foreground ${
          isOpen ? 'bg-surface-raised text-foreground' : ''
        } ${className}`}
      >
        <EllipsisHorizontalIcon className="h-4 w-4" />
      </button>
      {isOpen && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          style={{ top: position.top, left: position.left, width: MENU_WIDTH_PX }}
          className="fixed z-[9999] rounded-xl border border-border bg-surface py-1 shadow-popover"
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={(event) => { event.stopPropagation(); setIsOpen(false); item.onSelect(); }}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left ${MANAGEMENT_BODY_TEXT} transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] ${
                item.destructive ? 'text-red-500 dark:text-red-400' : 'text-foreground'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

export default CardOverflowMenu;
