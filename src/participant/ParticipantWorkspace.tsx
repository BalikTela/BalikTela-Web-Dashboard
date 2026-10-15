import { useState } from 'react';
import { BarterExchange } from '../pages/BarterExchange';
import { UserProfile } from '../pages/UserProfile';
import { ParticipantImpact } from './ParticipantImpact';
import { ParticipantLayout, type ParticipantPageKey } from './ParticipantLayout';
import { ParticipantOverview } from './ParticipantOverview';

export function ParticipantWorkspace() {
  const [activePage, setActivePage] = useState<ParticipantPageKey>('home');

  return (
    <ParticipantLayout activePage={activePage} onPageChange={setActivePage}>
      <div key={activePage} className="page-enter">
        {activePage === 'home' ? <ParticipantOverview onNavigate={setActivePage} /> : null}
        {activePage === 'marketplace' ? <BarterExchange lockedTab title="Textile Marketplace" description="Browse available sample materials, compare terms, and submit a traceable offer." /> : null}
        {activePage === 'inventory' ? <BarterExchange lockedTab listingScope="mine" title="My Materials and Listings" description="Publish and review the material records owned by this account." /> : null}
        {activePage === 'activity' ? <BarterExchange initialTab="Offers" lockedTab title="Offers and Exchange Activity" description="Review incoming and outgoing proposals, quantities, terms, and decisions." /> : null}
        {activePage === 'messages' ? <BarterExchange initialTab="Messages" lockedTab title="Material Conversations" description="Coordinate collection, validation, and terms inside each exchange thread." /> : null}
        {activePage === 'wallet' ? <BarterExchange initialTab="Wallet" lockedTab title="Eco-Wallet" description="Review the source and status of non-cash demo reward credits." /> : null}
        {activePage === 'impact' ? <ParticipantImpact /> : null}
        {activePage === 'profile' ? <UserProfile /> : null}
      </div>
    </ParticipantLayout>
  );
}
