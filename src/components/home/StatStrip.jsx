import { Icon } from '../../lib/icons.jsx';
import { useI18n } from '../../lib/i18n.jsx';

const ITEMS = [
  { icon: 'user', titleKey: 'statPeopleTitle', subKey: 'statPeopleSub' },
  { icon: 'building', titleKey: 'statOfficesTitle', subKey: 'statOfficesSub' },
  { icon: 'clock', titleKey: 'statTimelinesTitle', subKey: 'statTimelinesSub' },
  { icon: 'document', titleKey: 'statSourcesTitle', subKey: 'statSourcesSub' },
];

/**
 * The glass strip beneath the key-figure cards: the repository-derived total
 * people count on the left, then four fixed (icon, title, sub) items. Only
 * the count is data — the four captions are the hero build's own fixed
 * copy, not something the repository tracks per-item.
 */
export function StatStrip({ peopleCount }) {
  const { t } = useI18n();
  return <div className="home-hero__stats">
    <div className="home-hero__stats-count">
      <Icon name="document"/>
      <span>
        <span className="home-hero__stats-number">{peopleCount.toLocaleString('en-US')}</span>
        <span className="home-hero__stats-label">{t('home.hero.statRecordsLabel')}</span>
      </span>
    </div>
    {ITEMS.map(item => <div className="home-hero__stats-item" key={item.icon}>
      <Icon name={item.icon}/>
      <span>
        <span className="home-hero__stats-item-title">{t(`home.hero.${item.titleKey}`)}</span>
        <span className="home-hero__stats-item-sub">{t(`home.hero.${item.subKey}`)}</span>
      </span>
    </div>)}
  </div>;
}
