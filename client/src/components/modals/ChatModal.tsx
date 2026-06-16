import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest } from '@/lib/queryClient';
import { MessageCircle, Send, User, Circle, Search } from 'lucide-react';
import { format } from 'date-fns';
import { ru, enUS } from 'date-fns/locale';
import { devLog } from '@/lib/debug';

interface ChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Message {
  id: number;
  senderId: number;
  receiverId: number;
  content: string;
  createdAt: string;
  updatedAt?: string;
  isRead?: boolean;
  sender?: {
    id: number;
    fullName: string;
    position: string;
  };
}

export default function ChatModal({ open, onOpenChange }: ChatModalProps) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const locale = language === 'en' ? enUS : ru;
  const queryClient = useQueryClient();
  
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch all employees only when searching
  const { data: employees = [] } = useQuery({
    queryKey: ['/api/users'],
    enabled: open && !!searchQuery.trim(),
  });

  // Fetch employees with whom user has conversations
  const { data: conversationEmployees = [] } = useQuery({
    queryKey: ['/api/messages/conversations'],
    queryFn: () => apiRequest('GET', '/api/messages/conversations'),
    enabled: open,
  });

  // Fetch online status for all users
  const { data: usersWithStatus = [] } = useQuery({
    queryKey: ['/api/users/online-status'],
    queryFn: () => apiRequest('GET', '/api/users/online-status'),
    enabled: open,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch messages for selected employee
  const { data: messagesData, isLoading: messagesLoading, error: messagesError } = useQuery({
    queryKey: ['/api/messages', selectedEmployeeId],
    queryFn: () => apiRequest('GET', `/api/messages/${selectedEmployeeId}`),
    enabled: open && !!selectedEmployeeId,
  });

  // Ensure messages is always an array
  const messages = Array.isArray(messagesData) ? messagesData : [];

  // Debug log
  devLog('Messages API Debug:', { 
    messagesData: typeof messagesData === 'object' ? JSON.stringify(messagesData) : messagesData,
    messages,
    isArray: Array.isArray(messages),
    length: messages.length,
    selectedEmployeeId,
    messagesLoading,
    messagesError,
    url: `/api/messages/${selectedEmployeeId}`,
    userLogged: !!user?.id,
    currentUserId: user?.id
  });

  // Filter employees based on search query or show conversation history
  const filteredEmployees = useMemo(() => {
    if (searchQuery.trim()) {
      // Show search results from all employees
      const otherEmployees = Array.isArray(employees) ? employees.filter((emp: any) => emp.id !== user?.id) : [];
      return otherEmployees.filter((emp: any) =>
        emp.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.position?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    } else {
      // Show only employees with existing conversations
      const conversations = Array.isArray(conversationEmployees) ? conversationEmployees : [];
      return conversations.filter((emp: any) => emp.id !== user?.id);
    }
  }, [employees, conversationEmployees, user?.id, searchQuery]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: (messageData: { receiverId: number; content: string }) =>
      apiRequest('POST', '/api/messages', messageData),
    onSuccess: (newMessage) => {
      setNewMessage('');
      if (newMessage?.id) {
        queryClient.setQueryData(['/api/messages', selectedEmployeeId], (prev: any) =>
          prev ? [...prev, newMessage] : [newMessage]
        );
      }
      
      // Force refresh of messages
      queryClient.invalidateQueries({ queryKey: ['/api/messages', selectedEmployeeId] });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/conversations'] });
      
      // Check if this is the first message to this employee
      const isNewConversation = !conversationEmployees.some((emp: any) => emp.id === selectedEmployeeId);
      
      if (isNewConversation) {
        setSearchQuery('');
      }
    },
  });

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedEmployeeId || sendMessageMutation.isPending) return;
    
    sendMessageMutation.mutate({
      receiverId: selectedEmployeeId,
      content: newMessage.trim(),
    });
  };

  const selectedEmployee = useMemo(() => {
    if (!selectedEmployeeId) return null;
    
    const employee = (Array.isArray(employees) ? employees : [])
      .concat(Array.isArray(conversationEmployees) ? conversationEmployees : [])
      .find((emp: any) => emp.id === selectedEmployeeId);
      
    if (!employee) return null;
    
    // Add online status from usersWithStatus
    const userStatus = Array.isArray(usersWithStatus) 
      ? usersWithStatus.find((u: any) => u.id === selectedEmployeeId)
      : null;
    return {
      ...employee,
      isOnline: userStatus?.isOnline || false,
      lastSeenAt: userStatus?.lastSeenAt,
    };
  }, [selectedEmployeeId, employees, conversationEmployees, usersWithStatus]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] p-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            {t('employeeChat')}
          </DialogTitle>
          <DialogDescription>
            {t('chatWithEmployees')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[60vh]">
          {/* Employee List */}
          <div className="w-1/3 border-r border-gray-200">
            <div className="p-4 border-b border-gray-200">
              <h3 className="font-medium text-gray-900 mb-3">{t('employees')}</h3>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  placeholder={t('searchEmployees')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <ScrollArea className="h-full">
              <div className="p-2">
                {filteredEmployees.map((employee: any) => (
                  <div
                    key={employee.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 ${
                      selectedEmployeeId === employee.id ? 'bg-primary/10 ring-1 ring-primary/20' : ''
                    }`}
                    onClick={() => setSelectedEmployeeId(employee.id)}
                  >
                    <Avatar className="w-10 h-10">
                      <AvatarFallback>
                        {employee.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-900 truncate">
                        {employee.fullName}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {employee.position}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {(() => {
                        const userStatus = Array.isArray(usersWithStatus)
                          ? usersWithStatus.find((u: any) => u.id === employee.id)
                          : null;
                        const isOnline = userStatus?.isOnline || false;
                        return (
                          <>
                            <Circle className={`w-2 h-2 ${isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-400 text-slate-400'}`} />
                            <span className="text-xs text-slate-500">{isOnline ? t('online') : t('offline')}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ))}
                {filteredEmployees.length === 0 && (
                  <div className="text-center py-8 text-slate-500">
                    <User className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm">
                      {searchQuery ? t('noSearchResults') : t('noConversationsYet')}
                    </p>
                    {!searchQuery && (
                      <p className="text-xs text-slate-400 mt-1">{t('useSearchToStartChat')}</p>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col">
            {selectedEmployee ? (
              <>
                {/* Chat Header */}
                <div className="p-4 border-b border-slate-200/70 bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback>
                        {selectedEmployee.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{selectedEmployee.fullName}</p>
                      <p className="text-xs text-slate-500">{selectedEmployee.position}</p>
                    </div>
                    <Badge
                      variant={selectedEmployee.isOnline ? "default" : "secondary"}
                      className={`ml-auto ${selectedEmployee.isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                      <Circle className={`w-2 h-2 mr-1 ${selectedEmployee.isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-400 text-slate-400'}`} />
                      {selectedEmployee.isOnline ? t('online') : t('offline')}
                    </Badge>
                  </div>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-4">
                    {messagesLoading ? (
                      <div className="text-center py-8 text-gray-500">
                        <p className="text-sm">{t('loadingMessages')}</p>
                      </div>
                    ) : Array.isArray(messages) && messages.length > 0 ? (
                      messages.map((message: Message) => {
                        const isOwnMessage = message.senderId === user?.id;
                        return (
                          <div
                            key={`${message.id}-${message.createdAt}`}
                            className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${
                                isOwnMessage
                                  ? 'text-white rounded-br-sm'
                                  : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                              }`}
                              style={isOwnMessage ? { background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))' } : undefined}
                            >
                              <p className="text-sm leading-relaxed">{message.content}</p>
                              <p
                                className={`text-xs mt-1 ${
                                  isOwnMessage ? 'text-white/70' : 'text-slate-500'
                                }`}
                              >
                                {(() => {
                                  try {
                                    return message.createdAt ? format(new Date(message.createdAt), 'HH:mm', { locale }) : '';
                                  } catch (e) {
                                    return t('now');
                                  }
                                })()}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-8 text-slate-500">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="text-sm">{t('noMessagesYet')}</p>
                        <p className="text-xs text-slate-400 mt-1">{t('startConversation')}</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {/* Message Input */}
                <div className="p-4 border-t border-slate-200/70">
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('typeMessage')}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                    />
                    <Button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                      size="icon"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500">
                <div className="text-center">
                  <MessageCircle className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                  <p className="text-lg font-medium mb-2">{t('selectEmployee')}</p>
                  <p className="text-sm text-slate-400">{t('chatWithEmployees')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
