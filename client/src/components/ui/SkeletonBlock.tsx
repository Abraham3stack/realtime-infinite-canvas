import type { FC } from 'react';

interface SkeletonBlockProps {
  className?: string;
}

export const SkeletonBlock: FC<SkeletonBlockProps> = ({ className }) => {
  const skeletonClass = ['skeleton-block', className].filter(Boolean).join(' ');
  return <div className={skeletonClass} aria-hidden="true" />;
};
