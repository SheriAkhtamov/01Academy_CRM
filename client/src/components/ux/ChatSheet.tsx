import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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

interface ChatSheetProps {
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

export default function ChatSheet({ open, onOpenChange }: ChatSheetProps) {
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
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['/api/messages', selectedEmployeeId],
    queryFn: () => apiRequest('GET', `/api/messages/${selectedEmployeeId}`),
    enabled: open && !!selectedEmployeeId,
  });

  // Ensure messages is always an array
  const messages = Array.isArray(messagesData) ? messagesData : [];

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
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="w-[min(960px,calc(100vw-1rem))] max-w-none p-0 sm:max-w-2xl lg:max-w-4xl"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="flex items-center gap-2">
            <MessageCircle />
            {t('employeeChat')}
          </SheetTitle>
          <SheetDescription>
            {t('chatWithEmployees')}
          </SheetDescription>
        </SheetHeader>

        <div className="flex h-[calc(100vh-101px)] min-h-0">
          {/* Employee List */}
          <div className="flex w-40 shrink-0 flex-col border-r border-border sm:w-64 lg:w-72">
            <div className="border-b border-border p-3 sm:p-4">
              <h3 className="mb-3 hidden font-medium text-foreground sm:block">{t('employees')}</h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('searchEmployees')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-2">
                {filteredEmployees.map((employee: any) => (
                  <div
                    key={employee.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors hover:bg-muted ${
                      selectedEmployeeId === employee.id ? 'bg-primary/10 ring-1 ring-primary/20' : ''
                    }`}
                    onClick={() => setSelectedEmployeeId(employee.id)}
                  >
                    <Avatar className="size-10">
                      <AvatarFallback>
                        {employee.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || t('unknown').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {employee.fullName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {employee.position}
                      </p>
                    </div>
                    <div className="hidden items-center gap-1 lg:flex">
                      {(() => {
                        const userStatus = Array.isArray(usersWithStatus)
                          ? usersWithStatus.find((u: any) => u.id === employee.id)
                          : null;
                        const isOnline = userStatus?.isOnline || false;
                        return (
                          <>
                            <Circle className={`size-2 ${isOnline ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-400 text-slate-400'}`} />
                            <span className="text-xs text-muted-foreground">{isOnline ? t('online') : t('offline')}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ))}
                {filteredEmployees.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground">
                    <User className="mx-auto mb-2 size-8 opacity-40" />
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
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedEmployee ? (
              <>
                {/* Chat Header */}
                <div className="border-b border-border bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback>
                        {selectedEmployee.fullName?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || t('unknown').charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{selectedEmployee.fullName}</p>
                      <p className="text-xs text-muted-foreground">{selectedEmployee.position}</p>
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
                  <div className="flex flex-col gap-4">
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
                      onKeyDown={(e) => {
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
                      <Send />
                      <span className="sr-only">{t('send')}</span>
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
      </SheetContent>
    </Sheet>
  );
}
