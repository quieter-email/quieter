import { mailRouter } from "./routers/mail";

export const desktopRouter = {
  mail: {
    getThread: mailRouter.getThread,
    listLabels: mailRouter.listLabels,
    listMailboxes: mailRouter.listMailboxes,
    listThreads: mailRouter.listThreads,
    markThreadAsRead: mailRouter.markThreadAsRead,
    markThreadAsUnread: mailRouter.markThreadAsUnread,
    moveThreadToTrash: mailRouter.moveThreadToTrash,
    sendMessage: mailRouter.sendMessage,
    updateThreadLabels: mailRouter.updateThreadLabels,
  },
};
