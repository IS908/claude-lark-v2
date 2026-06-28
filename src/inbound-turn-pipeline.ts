export type InboundKind = 'im_p2p' | 'group_at_bot' | 'doc_comment';

export interface InboundTurn {
  kind: InboundKind;
  chatId: string;
  threadId: string | null;
  openId: string;
  messageId: string;
  text: string;
  imagePaths: string[];
  requireReply: boolean;
  rawMeta: Record<string, unknown>;
}

export interface RawImEvent {
  chatType: 'p2p' | 'group';
  chatId: string;
  messageId: string;
  senderOpenId: string;
  text: string;
  imagePaths?: string[];
  mentionsBot?: boolean;
  threadKey?: string;
}

export interface RawDocCommentEvent {
  docToken: string;
  commentId: string;
  replyId: string;
  fromOpenId: string;
  text: string;
  isMentioned: boolean;
}

export function normalizeIm(ev: RawImEvent): InboundTurn | null {
  if (ev.chatType === 'group' && !ev.mentionsBot) return null;
  const kind: InboundKind = ev.chatType === 'p2p' ? 'im_p2p' : 'group_at_bot';
  return {
    kind,
    chatId: ev.chatId,
    threadId: ev.threadKey ?? null,
    openId: ev.senderOpenId,
    messageId: ev.messageId,
    text: ev.text,
    imagePaths: ev.imagePaths ?? [],
    requireReply: true,
    rawMeta: { chatType: ev.chatType },
  };
}

export function normalizeDocComment(ev: RawDocCommentEvent): InboundTurn | null {
  if (!ev.isMentioned) return null;
  return {
    kind: 'doc_comment',
    chatId: `doc:${ev.docToken}`,
    threadId: ev.commentId,
    openId: ev.fromOpenId,
    messageId: ev.replyId,
    text: ev.text,
    imagePaths: [],
    requireReply: true,
    rawMeta: { docToken: ev.docToken, commentId: ev.commentId, replyId: ev.replyId },
  };
}
