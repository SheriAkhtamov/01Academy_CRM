import { chatGroupStorage } from '../storage/chat-group.storage';
import { createChatGroupRouter } from '../routes/chat-groups.routes';

export default createChatGroupRouter(chatGroupStorage);
