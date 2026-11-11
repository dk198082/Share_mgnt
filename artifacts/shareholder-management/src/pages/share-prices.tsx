import { PageHeader } from '@/components/shell';
import { PriceHistory } from '@/components/settings/price-history';

export default function SharePrices() {
  return <div className="pb-16">
    <PageHeader eyebrow="Registry" title="Share prices" />
    <div className="px-6 py-8 md:px-10"><PriceHistory /></div>
  </div>;
}
