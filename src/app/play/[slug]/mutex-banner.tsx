// src/app/play/[slug]/mutex-banner.tsx
'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangleIcon } from 'lucide-react';

export function MutexBanner({ visible, message }: { visible: boolean; message: string }) {
  if (!visible) return null;
  return (
    <Alert variant="default" className="mb-3">
      <AlertTriangleIcon className="size-4" />
      <AlertTitle>Still working on the previous turn</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
