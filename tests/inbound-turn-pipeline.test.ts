import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeIm, normalizeDocComment } from '../src/inbound-turn-pipeline.js';

test('p2p IM message produces im_p2p turn with requireReply=true', () => {
  const t = normalizeIm({
    chatType: 'p2p',
    chatId: 'oc_p2p',
    messageId: 'om_1',
    senderOpenId: 'ou_user',
    text: 'hello',
  });
  assert.ok(t);
  assert.equal(t!.kind, 'im_p2p');
  assert.equal(t!.requireReply, true);
  assert.equal(t!.threadId, null);
});

test('group message without @bot is dropped', () => {
  const t = normalizeIm({
    chatType: 'group',
    chatId: 'oc_grp',
    messageId: 'om_2',
    senderOpenId: 'ou_user',
    text: 'just chatter',
    mentionsBot: false,
  });
  assert.equal(t, null);
});

test('group @bot message produces group_at_bot turn', () => {
  const t = normalizeIm({
    chatType: 'group',
    chatId: 'oc_grp',
    messageId: 'om_3',
    senderOpenId: 'ou_user',
    text: '@bot hi',
    mentionsBot: true,
    threadKey: 'thread-123',
  });
  assert.ok(t);
  assert.equal(t!.kind, 'group_at_bot');
  assert.equal(t!.threadId, 'thread-123');
});

test('image paths propagate through normalization', () => {
  const t = normalizeIm({
    chatType: 'p2p',
    chatId: 'oc_p2p',
    messageId: 'om_4',
    senderOpenId: 'ou_user',
    text: 'see image',
    imagePaths: ['/inbox/a.jpg'],
  });
  assert.deepEqual(t?.imagePaths, ['/inbox/a.jpg']);
});

test('doc comment with @bot produces doc_comment turn with doc:<token> chatId', () => {
  const t = normalizeDocComment({
    docToken: 'doxk_abc',
    commentId: 'cmt_1',
    replyId: 'rep_1',
    fromOpenId: 'ou_user',
    text: '@bot what does this mean?',
    isMentioned: true,
  });
  assert.ok(t);
  assert.equal(t!.kind, 'doc_comment');
  assert.equal(t!.chatId, 'doc:doxk_abc');
  assert.equal(t!.threadId, 'cmt_1');
  assert.equal(t!.requireReply, true);
});

test('doc comment without @bot is dropped', () => {
  const t = normalizeDocComment({
    docToken: 'doxk',
    commentId: 'c',
    replyId: 'r',
    fromOpenId: 'ou',
    text: 'just commenting',
    isMentioned: false,
  });
  assert.equal(t, null);
});
