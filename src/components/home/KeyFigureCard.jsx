import { Icon } from '../../lib/icons.jsx';
import { Avatar, Unavailable } from '../Primitives.jsx';
import { useI18n } from '../../lib/i18n.jsx';

/**
 * One "key public figure" glass card on the home hero — President, Prime
 * Minister, Leader of the Opposition, Speaker of Parliament.
 *
 * `officeLabel` is a fixed editorial caption for the slot (matching the hero
 * build spec's own short-form labels — "Leader of Opposition", not the
 * longer institutional title), the same kind of editorial framing
 * `featuredOfficeHolders()` already documents for choosing WHO fills these
 * four slots. `member` is who the repository currently resolves into that
 * slot and is the only thing that can make the card a link: when an office
 * is vacant or unresolved this renders the existing `Unavailable` treatment
 * instead of dropping the card or inventing a name.
 */
export function KeyFigureCard({ officeLabel, member }) {
  const { t } = useI18n();

  if (!member) {
    return <div className="home-hero__figure home-hero__figure--empty">
      <Avatar name={officeLabel} portraitUrl={null}/>
      <span className="home-hero__figure-text">
        <span className="home-hero__figure-name"><Unavailable/></span>
        <span className="home-hero__figure-role">{officeLabel}</span>
      </span>
    </div>;
  }

  const href = `/person/${encodeURIComponent(member.slug)}`;
  return <a className="home-hero__figure" href={href} aria-label={t('home.hero.figureCardLabel', { name: member.name, role: officeLabel })}>
    <Avatar name={member.name} portraitUrl={member.portraitUrl}/>
    <span className="home-hero__figure-text">
      <span className="home-hero__figure-name">{member.name}</span>
      <span className="home-hero__figure-role">{officeLabel}</span>
    </span>
    <Icon name="chevronRight" className="home-hero__figure-chevron"/>
  </a>;
}
