import { useAuth } from "@workspace/replit-auth-web";
import { motion } from "framer-motion";
import { Ghost, Activity, Zap, Radio, Cpu, ShieldAlert, ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
};

const moduleCards = [
  {
    icon: Ghost,
    title: "Ghostwatch",
    desc: "Predictive modeling and precision projections. The foundation of your intelligence operation.",
    color: "text-primary",
    bg: "bg-primary/10",
    border: "border-primary/20",
  },
  {
    icon: Activity,
    title: "Ghost Express",
    desc: "Live, in-game AI that detects shifting momentum and line vulnerabilities in real-time.",
    color: "text-safe",
    bg: "bg-safe/10",
    border: "border-safe/20",
  },
  {
    icon: Zap,
    title: "Ghostspere",
    desc: "Your automation butler. Instantly build, share, and track sophisticated ticket constructions.",
    color: "text-balanced",
    bg: "bg-balanced/10",
    border: "border-balanced/20",
  },
  {
    icon: Radio,
    title: "Ghostobservation",
    desc: "Social sentiment and pulse tracking. Monitor breaking news before the market reacts.",
    color: "text-aggressive",
    bg: "bg-aggressive/10",
    border: "border-aggressive/20",
  },
];

export default function Cover() {
  const { login } = useAuth();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground selection:bg-primary/30 font-sans overflow-x-hidden relative">
      {/* Background Gradients & Noise */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-50 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
      <div className="fixed inset-0 pointer-events-none z-0 flex items-center justify-center">
        <div className="absolute w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] mix-blend-screen opacity-50" />
      </div>

      <div className="relative z-10">
        {/* Top Header */}
        <header className="px-6 py-6 lg:px-12 lg:py-8 flex justify-between items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-2 text-xs font-mono tracking-widest text-muted-foreground uppercase"
          >
            <ShieldAlert className="w-4 h-4 text-primary" />
            Classified Access
          </motion.div>
          <motion.a
            href="https://ghostroom.replit.app"
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-2 text-xs font-mono tracking-widest hover:text-primary transition-colors border border-border/50 bg-secondary/30 px-3 py-1.5 rounded-full"
          >
            Powered by Ghostroom <ArrowUpRight className="w-3 h-3" />
          </motion.a>
        </header>

        {/* Hero Section */}
        <main className="max-w-7xl mx-auto px-6 lg:px-12 pt-20 pb-32 flex flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, type: "spring", bounce: 0.4 }}
            className="bg-primary/10 p-5 rounded-2xl border border-primary/20 mb-10 inline-flex shadow-[0_0_40px_-10px_hsl(var(--primary))]"
          >
            <Ghost className="w-16 h-16 text-primary" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-6xl md:text-8xl font-black tracking-tighter text-foreground mb-6"
          >
            GHOSTWATCH
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="text-xl md:text-2xl text-muted-foreground max-w-2xl mb-12 font-medium"
          >
            The war room for serious sports bettors. Dark, precise, and heavily armed with intelligence.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 }}
            className="flex flex-col sm:flex-row items-center gap-4"
          >
            <Button
              size="lg"
              onClick={login}
              className="h-14 px-10 text-lg font-bold tracking-wide rounded-full group shadow-[0_0_30px_-5px_hsl(var(--primary))]"
            >
              Enter Terminal <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
            <div className="text-sm font-mono text-muted-foreground mt-4 sm:mt-0 sm:ml-4">
              Restricted Area. Authorized Personnel Only.
            </div>
          </motion.div>
        </main>

        {/* Modules Section */}
        <section className="border-y border-border/50 bg-secondary/20 backdrop-blur-xl relative">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 py-24">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Four Modules. Absolute Control.</h2>
              <p className="text-muted-foreground font-mono text-sm max-w-xl mx-auto">
                Our intelligence pipeline is broken into four distinct operational sectors, providing 360-degree market awareness.
              </p>
            </motion.div>

            <motion.div
              variants={container}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-100px" }}
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              {moduleCards.map((mod, i) => (
                <motion.div
                  key={i}
                  variants={item}
                  className="bg-card/50 backdrop-blur-sm border border-border p-8 rounded-2xl hover:bg-card/80 transition-all group"
                >
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-6 border ${mod.bg} ${mod.border}`}>
                    <mod.icon className={`w-7 h-7 ${mod.color}`} />
                  </div>
                  <h3 className="text-xl font-bold mb-3">{mod.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {mod.desc}
                  </p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Ghostphere AI Section */}
        <section className="max-w-7xl mx-auto px-6 lg:px-12 py-32 relative overflow-hidden">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
          
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.7 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-mono font-bold mb-6">
                <Cpu className="w-4 h-4" /> NEW
              </div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6">
                Meet Ghostphere AI.
              </h2>
              <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                Your personal sports intelligence operator. Streamline your research, dissect matchups, and generate ticket structures through a powerful conversational interface. Ask anything. It knows.
              </p>
              
              <ul className="space-y-4 mb-10">
                {["Live odds integration & analysis", "Automated ticket construction", "Real-time momentum scanning"].map((feature, idx) => (
                  <li key={idx} className="flex items-center gap-3 text-foreground font-medium">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <Zap className="w-3 h-3 text-primary" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>

              <Button onClick={login} variant="outline" className="h-12 px-8 rounded-full">
                Activate Ghostphere
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotateY: -10 }}
              whileInView={{ opacity: 1, scale: 1, rotateY: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className="relative perspective-1000"
            >
              <div className="bg-card border border-border rounded-2xl p-6 shadow-2xl relative z-10 transform-gpu rotate-y-[-5deg] rotate-x-[5deg]">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border/50">
                  <div className="w-3 h-3 rounded-full bg-destructive/80" />
                  <div className="w-3 h-3 rounded-full bg-balanced/80" />
                  <div className="w-3 h-3 rounded-full bg-safe/80" />
                  <div className="ml-auto text-xs font-mono text-muted-foreground">ghostphere_terminal</div>
                </div>
                
                <div className="space-y-6">
                  <div className="flex justify-end">
                    <div className="bg-primary/20 border border-primary/30 text-foreground px-4 py-3 rounded-2xl rounded-tr-sm max-w-[80%] text-sm">
                      Analyze the Lakers vs Warriors matchup tonight. Any vulnerabilities?
                    </div>
                  </div>
                  <div className="flex justify-start items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                      <Ghost className="w-4 h-4 text-primary" />
                    </div>
                    <div className="bg-secondary/50 border border-border text-foreground px-4 py-3 rounded-2xl rounded-tl-sm max-w-[90%] text-sm leading-relaxed">
                      Scanning matchup... <br/><br/>
                      The line has shifted +2.5 for LAL in the last hour. GSW interior defense rating has dropped 14% over their last 3 games. The highest +EV play is <strong>LAL Moneyline</strong>.
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border bg-card/30">
          <div className="max-w-7xl mx-auto px-6 lg:px-12 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
              <Ghost className="w-5 h-5" />
              <span className="font-bold tracking-tight">Ghostwatch</span>
            </div>
            
            <div className="text-sm font-mono text-muted-foreground">
              Ghostroom © 2025. All operations logged.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}