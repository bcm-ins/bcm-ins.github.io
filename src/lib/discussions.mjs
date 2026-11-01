// Shared public projection: never export viewer-specific permissions in build snapshots.
export const commentFields = `id body createdAt updatedAt isAnswer isMinimized upvoteCount
  author { login avatarUrl } replyTo { id }
  viewerCanUpdate viewerCanDelete viewerCanUpvote viewerHasUpvoted viewerCanMarkAsAnswer viewerCanUnmarkAsAnswer`;
export function publicComment(c, viewer = false) {
  return {
    id:c.id, body:c.isMinimized ? '' : c.body, createdAt:c.createdAt, updatedAt:c.updatedAt,
    author:c.author?.login || '已注销用户', avatar:c.author?.avatarUrl || '',
    replyToId:c.replyTo?.id || null, isAnswer:!!c.isAnswer, isMinimized:!!c.isMinimized,
    upvotes:c.upvoteCount || 0,
    ...(viewer ? {canEdit:!!c.viewerCanUpdate,canDelete:!!c.viewerCanDelete,canUpvote:!!c.viewerCanUpvote,hasUpvoted:!!c.viewerHasUpvoted,canAnswer:!!c.viewerCanMarkAsAnswer,canUnanswer:!!c.viewerCanUnmarkAsAnswer} : {}),
  };
}
