import { Link } from 'react-router-dom';
import { CalendarDays, User, Wallet, Gauge, Sparkles, FileText } from 'lucide-react';
export default function More() {
  const items = [['/ask', 'Ask anything', 'Web answers with sources', Sparkles], ['/sprint', '30-day sprint', 'Tasks, plan, pipeline, mentor', CalendarDays], ['/profile', 'My profile', 'What the app may say about you', User], ['/offers', 'Offers', 'Compare and negotiate', Wallet], ['/status', 'AI status', 'Limits of every model', Gauge]] as const;
  return (
    <div className="space-y-3"><h1 className="mb-4 text-3xl font-bold">More</h1>
      {items.map(([to, t, d, Icon]) => <Link key={to} to={to} className="glass flex items-center gap-4 p-4"><Icon className="h-5 w-5 text-violet" /><div><p className="font-semibold">{t}</p><p className="text-sm text-ink-3">{d}</p></div></Link>)}
      <Link to="/progress" className="glass flex items-center gap-4 p-4"><FileText className="h-5 w-5 text-teal" /><div><p className="font-semibold">Progress</p><p className="text-sm text-ink-3">Rings, skill ratings, bests</p></div></Link>
    </div>
  );
}
