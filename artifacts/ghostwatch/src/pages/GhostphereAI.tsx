import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { 
  useListOpenaiConversations, 
  useCreateOpenaiConversation,
  useGetOpenaiConversation,
  useDeleteOpenaiConversation,
  getGetOpenaiConversationQueryKey,
} from "@workspace/api-client-react";
import { 
  Ghost, Bot, Send, Trash2, Plus, MessageSquare, Loader2, Menu 
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

// Simple markdown formatter
function FormattedText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\n- .*)/g);
  
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="bg-secondary/50 px-1 py-0.5 rounded font-mono text-xs">{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('\n- ')) {
          return <div key={i} className="flex gap-2 mt-1"><div className="w-1 h-1 rounded-full bg-current mt-2 shrink-0" /><span>{part.slice(3)}</span></div>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

const SUGGESTED_QUESTIONS = [
  "What are today's safest picks?",
  "Analyze the Lakers vs Warriors matchup",
  "Build me a 3-pick Safe ticket for tonight",
  "What social signals should I watch today?"
];

export default function GhostphereAI() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: conversations, isLoading: isLoadingList } = useListOpenaiConversations();
  const createConv = useCreateOpenaiConversation();
  const deleteConv = useDeleteOpenaiConversation();

  // Load active conversation
  const { data: activeConv, isLoading: isLoadingConv } = useGetOpenaiConversation(activeId!, { 
    query: { enabled: !!activeId, queryKey: getGetOpenaiConversationQueryKey(activeId!) } 
  });

  // Auto-create initial conversation if empty
  useEffect(() => {
    if (!isLoadingList && conversations && conversations.length === 0 && !createConv.isPending && !activeId) {
      createConv.mutate({ data: { title: "Ghostphere Session" } }, {
        onSuccess: (newConv) => {
          setActiveId(newConv.id);
          queryClient.invalidateQueries({ queryKey: ['/api/openai/conversations'] });
        }
      });
    } else if (!isLoadingList && conversations && conversations.length > 0 && !activeId) {
      // Auto-select latest
      setActiveId(conversations[0].id);
    }
  }, [conversations, isLoadingList, createConv, activeId, queryClient]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeConv?.messages, streamingContent]);

  const handleNewChat = () => {
    createConv.mutate({ data: { title: "New Session" } }, {
      onSuccess: (newConv) => {
        setActiveId(newConv.id);
        queryClient.invalidateQueries({ queryKey: ['/api/openai/conversations'] });
      }
    });
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteConv.mutate({ id }, {
      onSuccess: () => {
        if (activeId === id) setActiveId(null);
        queryClient.invalidateQueries({ queryKey: ['/api/openai/conversations'] });
      }
    });
  };

  const handleSend = async (text: string = input) => {
    if (!text.trim() || !activeId || isStreaming) return;

    const userMsg = text.trim();
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");

    // Optimistically add user message to cache
    queryClient.setQueryData(['/api/openai/conversations', activeId], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        messages: [...(old.messages || []), { role: "user", content: userMsg, id: Date.now() }]
      };
    });

    try {
      const response = await fetch(`/api/openai/conversations/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: userMsg }),
        credentials: "include",
      });

      if (!response.ok) throw new Error("Failed to send message");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;
            
            try {
              const data = JSON.parse(dataStr);
              if (data.content) {
                fullContent += data.content;
                setStreamingContent(prev => prev + data.content);
              }
              if (data.done) {
                // Done streaming
              }
            } catch (e) {
              console.error("Parse error stream:", e);
            }
          }
        }
      }

      // Sync final state
      queryClient.invalidateQueries({ queryKey: [`/api/openai/conversations/${activeId}`] });
      // Update title if needed
      queryClient.invalidateQueries({ queryKey: ['/api/openai/conversations'] });

    } catch (err) {
      console.error(err);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
    }
  };

  return (
    <div className="flex h-full bg-background overflow-hidden relative">
      
      {/* Sidebar Toggle (Mobile / Collapsed) */}
      <Button 
        variant="ghost" 
        size="icon" 
        className={cn(
          "absolute top-4 left-4 z-20 md:hidden",
          sidebarOpen && "left-[260px]" // push right when open on mobile
        )}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Conversation History Sidebar */}
      <div className={cn(
        "w-64 border-r border-border bg-card/50 flex flex-col shrink-0 absolute md:relative z-10 h-full transition-transform duration-300",
        !sidebarOpen && "-translate-x-full md:translate-x-0",
        sidebarOpen && "translate-x-0"
      )}>
        <div className="p-4 border-b border-border">
          <Button 
            onClick={handleNewChat} 
            className="w-full gap-2 shadow-none border-primary/20 bg-primary/10 text-primary hover:bg-primary/20"
            variant="outline"
            disabled={createConv.isPending}
          >
            {createConv.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            New Target
          </Button>
        </div>
        
        <ScrollArea className="flex-1 p-2">
          {isLoadingList ? (
            <div className="flex justify-center p-4"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>
          ) : conversations?.map(conv => (
            <div 
              key={conv.id}
              onClick={() => setActiveId(conv.id)}
              className={cn(
                "group flex items-center justify-between p-3 mb-1 rounded-lg cursor-pointer transition-colors border",
                activeId === conv.id 
                  ? "bg-accent/10 border-accent/30 text-accent-foreground" 
                  : "border-transparent hover:bg-secondary/50 text-muted-foreground"
              )}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
                <span className="text-sm font-medium truncate">{conv.title}</span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="w-6 h-6 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 shrink-0"
                onClick={(e) => handleDelete(e, conv.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] relative">
        <div className="absolute inset-0 pointer-events-none opacity-[0.02]" />

        {/* Header */}
        <header className="h-16 border-b border-border bg-card/80 backdrop-blur-md flex items-center px-6 sticky top-0 z-10 shrink-0 md:pl-6 pl-16">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center">
              <Ghost className="w-4 h-4 text-accent" />
            </div>
            <div>
              <h2 className="font-bold tracking-tight">Ghostphere Intelligence</h2>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Model: Operator-v1</p>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6"
        >
          {isLoadingConv ? (
            <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
          ) : !activeConv?.messages?.length ? (
            <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-6 shadow-[0_0_30px_-5px_hsl(var(--accent))]">
                <Bot className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Systems Online.</h3>
              <p className="text-muted-foreground mb-8">
                Ghostphere is ready to process market data, construct tickets, and analyze matchups. What do you need?
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button 
                    key={i}
                    onClick={() => handleSend(q)}
                    className="text-left p-4 rounded-xl border border-border bg-card/50 hover:bg-card hover:border-primary/50 transition-colors text-sm font-medium"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-6 pb-4">
              {activeConv.messages.map((msg, i) => (
                <div 
                  key={msg.id || i} 
                  className={cn(
                    "flex gap-4",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0 mt-1">
                      <Ghost className="w-4 h-4 text-accent" />
                    </div>
                  )}
                  
                  <div className={cn(
                    "px-4 py-3 rounded-2xl max-w-[85%] text-[15px] leading-relaxed",
                    msg.role === "user" 
                      ? "bg-primary/20 border border-primary/30 text-foreground rounded-tr-sm" 
                      : "bg-card border border-border text-foreground rounded-tl-sm shadow-sm"
                  )}>
                    <FormattedText text={msg.content} />
                  </div>

                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0 mt-1 overflow-hidden">
                      <span className="text-xs font-bold text-muted-foreground">U</span>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Streaming Message Placeholder */}
              {isStreaming && (
                <div className="flex gap-4 justify-start">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0 mt-1">
                    <Ghost className="w-4 h-4 text-accent" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl max-w-[85%] text-[15px] leading-relaxed bg-card border border-border text-foreground rounded-tl-sm shadow-sm">
                    {streamingContent ? (
                      <FormattedText text={streamingContent} />
                    ) : (
                      <div className="flex gap-1 items-center h-5">
                        <div className="w-1.5 h-1.5 bg-accent/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-1.5 h-1.5 bg-accent/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-1.5 h-1.5 bg-accent/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-gradient-to-t from-background via-background/95 to-transparent sticky bottom-0 z-10 shrink-0">
          <div className="max-w-3xl mx-auto relative">
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="relative flex items-end gap-2 bg-card border border-border rounded-xl shadow-lg p-2 focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-all"
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Request intelligence..."
                className="border-0 shadow-none focus-visible:ring-0 text-base h-12 py-3 bg-transparent"
                disabled={isStreaming || !activeId}
              />
              <Button 
                type="submit" 
                size="icon" 
                disabled={!input.trim() || isStreaming || !activeId}
                className={cn(
                  "h-12 w-12 rounded-lg shrink-0 transition-all",
                  input.trim() ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-secondary text-muted-foreground"
                )}
              >
                <Send className="w-5 h-5" />
              </Button>
            </form>
            <div className="text-center mt-3 text-xs font-mono text-muted-foreground">
              Ghostphere Operator AI can make mistakes. Verify critical intel.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}