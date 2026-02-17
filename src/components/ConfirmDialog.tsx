import { useEffect, useRef, useState, useCallback } from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      confirmRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const confirmStyles =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-purple-600 hover:bg-purple-700 text-white';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[90] p-4" onClick={onCancel}>
      <div
        className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <h3 id="confirm-dialog-title" className="text-lg font-semibold text-white mb-2">
          {title}
        </h3>
        <p id="confirm-dialog-message" className="text-sm text-slate-300 mb-6">
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium text-slate-300 bg-slate-700 hover:bg-slate-600 rounded-md transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${confirmStyles}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for imperative usage
interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'danger' | 'default';
  resolve: ((value: boolean) => void) | null;
}

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    variant: 'default',
    resolve: null,
  });

  const confirm = useCallback(
    (options: {
      title: string;
      message: string;
      confirmLabel?: string;
      variant?: 'danger' | 'default';
    }): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          isOpen: true,
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel || 'Confirm',
          variant: options.variant || 'default',
          resolve,
        });
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((s) => ({ ...s, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((s) => ({ ...s, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const dialogProps = {
    isOpen: state.isOpen,
    title: state.title,
    message: state.message,
    confirmLabel: state.confirmLabel,
    variant: state.variant,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return { confirm, dialogProps };
}
