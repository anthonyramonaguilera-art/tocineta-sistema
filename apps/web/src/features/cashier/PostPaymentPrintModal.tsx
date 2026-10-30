import React from 'react';
import { Modal } from '../../ui/index.js';
import { PostPaymentPrintPanel } from './PostPaymentPrintPanel.js';

interface PostPaymentPrintModalProps {
  order: { id: string; orderNumber: number } | null;
  token?: string | null;
  onClose: () => void;
}

export const PostPaymentPrintModal: React.FC<PostPaymentPrintModalProps> = ({
  order,
  token,
  onClose
}) => {
  if (!order) return null;

  return (
    <Modal
      isOpen={Boolean(order)}
      onClose={onClose}
      title={`Impresion de Orden #${order.orderNumber}`}
    >
      <PostPaymentPrintPanel
        orderId={order.id}
        orderNumber={order.orderNumber}
        token={token}
        onClose={onClose}
      />
    </Modal>
  );
};
