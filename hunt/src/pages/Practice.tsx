import { Link } from 'react-router-dom';
import { Mic, Layers, Sparkles } from 'lucide-react';
import { useApp } from '../lib/state';
import { Card, PageHead, Ring, Empty } from '../components/ui';

export default function Practice() {
  const { targets } = useApp();
  return (
    <div className="space-y-6">
      <PageHead title="Practice" sub="Interviews test whether you can say what you know. Speak it here first." />
      <Link to="/studio/general?mode=explain" className="group relative block overflow-hidden rounded-xl2 border border-teal/30 bg-gradient-to-br from-teal/15 via-night-850 to-violet/15 p-7 transition hover:border-teal/60">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-teal/25 blur-3xl" />
        <Sparkles className="h-6 w-6 text-teal" /><h2 className="mt-3 text-2xl font-bold">Explain one of your projects</h2>
        <p className="mt-1 max-w-xl text-ink-2">Pick NL2SQL, Sentinel Kote or any project. Explain it out loud, get scored on clarity, structure and depth, then handle the follow-up.</p>
      </Link>
      {targets.length ? (
        <div className="grid gap-4 md:grid-cols-2">{targets.map(t => (
          <Card key={t.id}>
            <div className="flex items-center gap-4"><Ring value={t.readiness ?? 0} size={64} stroke={7} color="#8B7CFF"><span className="tnum text-sm font-bold">{t.readiness ?? 0}</span></Ring>
              <div className="min-w-0 flex-1"><p className="truncate font-display text-lg font-semibold">{t.company}</p><p className="text-sm text-ink-3">{t.mockCount ? `Best mock ${t.mockBest}/10` : 'No mocks yet'} · {t.cards?.known ?? 0}/{t.cards?.total ?? 0} cards known</p></div></div>
            <div className="mt-4 flex flex-wrap gap-2"><Link to={`/studio/${t.id}`} className="btn-primary"><Mic className="h-4 w-4" />Mock interview</Link><Link to={`/c/${t.id}/prepare`} className="btn-ghost"><Layers className="h-4 w-4" />Flashcards</Link></div>
          </Card>
        ))}</div>
      ) : <Empty title="Add a company to practise for it" action={<Link to="/new" className="btn-primary">Add a company</Link>}>Mock interviews follow that company’s real rounds.</Empty>}
    </div>
  );
}
