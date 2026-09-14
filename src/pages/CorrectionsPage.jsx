import React from 'react';
import { Icon } from '../lib/icons.jsx';
import { SectionHead, Notice } from '../components/Primitives.jsx';
import { SearchField } from '../components/SearchField.jsx';
import { Dropdown } from '../components/Dropdown.jsx';
import { allPeople, suggestPeople, getPersonBySlug } from '../services/repository.ts';
import { moveActiveIndex, resolveKeyAction } from '../lib/typeahead.ts';
import { useDebouncedValue } from '../lib/useDebouncedValue.ts';
import { validateCorrection, buildCorrectionPayload, CORRECTION_FIELDS } from '../services/corrections.ts';
import { isApiEnabled, submitCorrection, CorrectionRejected } from '../services/apiClient.ts';
import { applyPageMeta } from '../lib/seo.ts';
import { routeMeta } from '../lib/pageMeta.ts';
import { useI18n } from '../lib/i18n.jsx';

/**
 * The "Record" field's combobox. A plain `<select>` with 1,624 options was
 * the actual control here until this component replaced it — unusable to
 * scroll and, per the crawlability audit, one of the heaviest nodes on the
 * page. Modelled on SearchTypeahead's combobox pattern (same ARIA roles, same
 * `lib/typeahead.ts` key-handling), but deliberately its own component rather
 * than a reuse of SearchTypeahead: selecting a result here must set
 * `form.entityId` to `person.slug` and nothing else, where SearchTypeahead
 * always navigates. Free text the user types is never itself a valid
 * `entityId` — only an explicit selection is, so every keystroke clears the
 * previous selection until a suggestion is chosen again.
 */
function RecordPicker({ id, people, value, onChange, invalid, describedBy }) {
  const { t } = useI18n();
  const [query, setQuery] = React.useState(
    () => people.find(v => v.person.slug === value)?.person.canonicalName ?? '',
  );
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const rootRef = React.useRef(null);
  const listId = `${id}-listbox-${React.useId()}`;

  const debouncedQuery = useDebouncedValue(query, 150);
  const results = React.useMemo(() => suggestPeople(debouncedQuery), [debouncedQuery]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const select = view => {
    setQuery(view.person.canonicalName);
    onChange(view.person.slug);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleChange = event => {
    const text = event.target.value;
    setQuery(text);
    setOpen(text.trim().length > 0);
    setActiveIndex(-1);
    onChange('');
  };

  const handleKeyDown = event => {
    const action = resolveKeyAction(event.key, { open, activeIndex, resultCount: results.length });
    if (action.type === 'move') {
      event.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex(index => moveActiveIndex(index, action.direction, results.length));
    } else if (action.type === 'select') {
      event.preventDefault();
      select(results[action.index]);
    } else if (action.type === 'close') {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const clear = () => {
    setQuery('');
    onChange('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const activeId = activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined;
  const showPanel = open && query.trim().length > 0;

  return <div className="typeahead" ref={rootRef}>
    <SearchField
      id={id}
      type="text"
      value={query}
      placeholder={t('corrections.recordSearchPlaceholder')}
      onChange={handleChange}
      onClear={clear}
      inputProps={{
        role: 'combobox',
        'aria-expanded': showPanel,
        'aria-controls': listId,
        'aria-autocomplete': 'list',
        'aria-activedescendant': activeId,
        'aria-invalid': invalid ? 'true' : undefined,
        'aria-describedby': describedBy,
        onKeyDown: handleKeyDown,
        onFocus: () => { if (query.trim()) setOpen(true); },
      }}
    />
    {showPanel ? <div className="typeahead__panel" id={listId} role="listbox" aria-label={t('corrections.matchingPeople')}>
      {results.length
        ? results.map((view, index) => (
            <div
              key={view.person.id}
              id={`${listId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`typeahead__option${index === activeIndex ? ' typeahead__option--active' : ''}`}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(view)}
            >
              <span className="typeahead__text">
                <span className="typeahead__name">{view.person.canonicalName}</span>
              </span>
            </div>
          ))
        : <div className="typeahead__empty" role="status">{t('corrections.noMatchingPeople')}</div>}
    </div> : null}
  </div>;
}

/**
 * Correction reporting.
 *
 * TWO MODES, AND THE PAGE ALWAYS SAYS WHICH IT IS IN.
 *
 * With `VITE_API_URL` set at build time, the form submits to
 * `POST /api/corrections` (server/api/corrections.ts) and the reporter is
 * told their report's reference. Without it — the default, and what a purely
 * static deployment with no API in front of it is — there is nowhere to send
 * a report, so the form validates, shows the reporter the structured record
 * it produced, and says plainly that nothing was transmitted.
 *
 * That second mode is not a stub left behind; it is the honest answer for a
 * deployment with no backend, and the reason the copy is conditional rather
 * than optimistic. Telling someone a correction was received when it was
 * silently discarded is the specific failure this page is built to avoid,
 * and it is why a submission failure below is reported as a failure rather
 * than smoothed over into the "here is your payload" path.
 *
 * `isApiEnabled()` reads a build-time constant, identical on the server and
 * in the browser, so the prerendered HTML and the hydrated tree agree.
 */

/**
 * What the site currently shows for this person and field.
 *
 * The reporter arrives from a profile with the record and often the field
 * already chosen (`?person=` / `?field=`, set by the "Suggest a correction"
 * link on the profile header), and the next thing the form asked them for
 * was a value the application is already displaying on the page they just
 * came from. This fills it in; they can edit it, and the server ignores it
 * either way — `onSubmit` deliberately does not transmit `currentValue`,
 * because the reviewer re-derives it from the record rather than trusting
 * what a form said the page showed.
 *
 * Person-level fields only. An office title or an office date belongs to ONE
 * of a person's positions, and this form has no way to say which, so those
 * stay blank rather than being filled with a guess at which position the
 * reporter meant.
 */
function currentValueFor(slug, fieldName) {
  if (!slug || !fieldName) return null;
  const view = getPersonBySlug(slug);
  if (!view) return null;
  switch (fieldName) {
    case 'canonicalName': return view.person.canonicalName;
    case 'aliases': return view.person.aliases.join(' · ');
    case 'dateOfBirth': return view.person.dateOfBirth ?? '';
    case 'dateOfDeath': return view.person.dateOfDeath ?? '';
    case 'party': return view.partyLabel ?? '';
    case 'district': return view.districtLabel ?? '';
    default: return null;
  }
}

/**
 * A rate limit's `retry-after`, in words a reporter can act on.
 *
 * Rounded up to the coarser unit deliberately: the limit's window is an hour,
 * so telling someone "try again in 47 minutes" implies a precision the fixed
 * window does not have, and being told to come back slightly too late costs
 * them nothing while slightly too early costs them another rejection.
 */
function retryHint(t, seconds) {
  if (!seconds) return null;
  if (seconds < 90) return t('corrections.retryOneMinute');
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t('corrections.retryMinutes', { minutes });
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? t('corrections.retryOneHour') : t('corrections.retryHours', { hours });
}

export default function CorrectionsPage({ route }) {
  const { t } = useI18n();
  const today = React.useMemo(() => new Date(), []);
  const people = allPeople(today);

  const params = new URLSearchParams(route?.search ?? '');
  const [form, setForm] = React.useState(() => ({
    entityId: params.get('person') ?? '',
    fieldName: params.get('field') ?? '',
    currentValue: '',
    proposedValue: '',
    supportingSourceUrl: '',
    explanation: '',
  }));
  /*
    Prefill, adjusted during render rather than in an effect (the same idiom
    SearchBar and Drawer use in Primitives.jsx): an effect would paint one
    frame with the empty field before correcting it. Keyed on the
    (record, field) pair it last filled for, so choosing a different field
    refills — it now refers to a different value — while typing inside the
    field is never overwritten.
  */
  const prefillKey = `${form.entityId}|${form.fieldName}`;
  // Starts null, which no real key can equal, so the FIRST render also runs
  // the prefill — that is the case that matters, since the record and field
  // usually arrive in the URL from a profile's "Suggest a correction" link.
  const [lastPrefillKey, setLastPrefillKey] = React.useState(null);
  const [prefilled, setPrefilled] = React.useState(false);
  if (prefillKey !== lastPrefillKey) {
    setLastPrefillKey(prefillKey);
    const derived = currentValueFor(form.entityId, form.fieldName);
    setPrefilled(derived !== null && derived !== '');
    if (derived !== null) setForm(previous => ({ ...previous, currentValue: derived }));
  }

  const [errors, setErrors] = React.useState(null);
  const [payload, setPayload] = React.useState(null);
  /** null | {state:'sending'} | {state:'filed', id, duplicate} | {state:'failed', message, retryAfterSeconds} */
  const [submission, setSubmission] = React.useState(null);
  const resultRef = React.useRef(null);

  const connected = isApiEnabled();

  React.useEffect(() => { applyPageMeta(routeMeta('corrections')); }, []);

  const update = (key, value) => setForm(previous => ({ ...previous, [key]: value }));

  // Move focus to the outcome so a screen reader announces it.
  const announce = () => requestAnimationFrame(() => resultRef.current?.focus());

  const onSubmit = event => {
    event.preventDefault();

    const validation = validateCorrection(form);
    if (!validation.valid) {
      setErrors(validation.errors);
      setPayload(null);
      setSubmission(null);
      announce();
      return;
    }

    setErrors(null);

    if (!connected) {
      // No API configured: validate and show the record, as before.
      setPayload(buildCorrectionPayload(form));
      setSubmission(null);
      announce();
      return;
    }

    setPayload(null);
    setSubmission({ state: 'sending' });
    announce();

    // The client's validation above is a convenience for the reporter; the
    // server re-runs all of it, and `currentValue` is deliberately not sent —
    // it re-derives that from the record rather than trusting what this page
    // happened to display.
    submitCorrection({
      entityId: form.entityId,
      fieldName: form.fieldName,
      proposedValue: form.proposedValue,
      supportingSourceUrl: form.supportingSourceUrl,
      explanation: form.explanation,
    }).then(
      result => {
        setSubmission({ state: 'filed', id: result.id, duplicate: result.duplicate });
        announce();
      },
      error => {
        setSubmission({
          state: 'failed',
          message: error instanceof CorrectionRejected
            ? error.message
            : t('corrections.genericSendFailure'),
          retryAfterSeconds: error instanceof CorrectionRejected ? error.retryAfterSeconds : null,
        });
        announce();
      },
    );
  };

  const fieldError = key => errors?.[key] ?? null;

  return <>
    <header className="page-head">
      <div className="container page-head__inner">
        <p className="eyebrow">{t('corrections.eyebrow')}</p>
        <h1>{t('corrections.title')}</h1>
        <p className="lede">{t('corrections.lede')}</p>
      </div>
    </header>

    <section className="section section--tight">
      <div className="container">
        <div className="u-mb-8">
          {connected
            ? <Notice
                iconName="info"
                title={t('corrections.connectedNoticeTitle')}
                body={[t('corrections.connectedNoticeBody1'), t('corrections.connectedNoticeBody2')]}
              />
            : <Notice
                tone="warning"
                iconName="alert"
                title={t('corrections.disconnectedNoticeTitle')}
                body={[t('corrections.disconnectedNoticeBody1'), t('corrections.disconnectedNoticeBody2')]}
              />}
        </div>

        <form className="panel" onSubmit={onSubmit} noValidate>
          <SectionHead title={t('corrections.detailsTitle')} description={t('corrections.detailsDescription')}/>

          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="correction-entity">{t('corrections.recordLabel')}</label>
              <RecordPicker
                id="correction-entity"
                people={people}
                value={form.entityId}
                onChange={value => update('entityId', value)}
                invalid={Boolean(fieldError('entityId'))}
                describedBy={fieldError('entityId') ? 'error-entity' : undefined}
              />
              {fieldError('entityId') ? <p className="form-error" id="error-entity">{fieldError('entityId')}</p> : null}
            </div>

            <div className="form-field">
              <label htmlFor="correction-field">{t('corrections.fieldLabel')}</label>
              <Dropdown
                id="correction-field"
                value={form.fieldName}
                options={CORRECTION_FIELDS.map(field => ({ value: field.id, label: field.label }))}
                onChange={value => update('fieldName', value)}
                label={t('corrections.fieldLabel')}
                placeholder={t('corrections.selectField')}
                triggerClassName="field-select"
                invalid={Boolean(fieldError('fieldName'))}
                describedBy={fieldError('fieldName') ? 'error-field' : undefined}
              />
              {fieldError('fieldName') ? <p className="form-error" id="error-field">{fieldError('fieldName')}</p> : null}
            </div>

            <div className="form-field">
              <label htmlFor="correction-current">{t('corrections.currentValueLabel')}</label>
              <input
                id="correction-current"
                type="text"
                value={form.currentValue}
                onChange={event => { setPrefilled(false); update('currentValue', event.target.value); }}
                placeholder={t('corrections.currentValuePlaceholder')}
              />
              <p className="form-hint">
                {prefilled ? t('corrections.currentValuePrefilled') : t('corrections.currentValueHint')}
              </p>
            </div>

            <div className="form-field">
              <label htmlFor="correction-proposed">{t('corrections.proposedValueLabel')}</label>
              <input
                id="correction-proposed"
                type="text"
                value={form.proposedValue}
                onChange={event => update('proposedValue', event.target.value)}
                placeholder={t('corrections.proposedValuePlaceholder')}
                aria-invalid={fieldError('proposedValue') ? 'true' : undefined}
                aria-describedby={fieldError('proposedValue') ? 'error-proposed' : undefined}
              />
              {fieldError('proposedValue') ? <p className="form-error" id="error-proposed">{fieldError('proposedValue')}</p> : null}
            </div>

            <div className="form-field form-field--wide">
              <label htmlFor="correction-source">{t('corrections.sourceUrlLabel')}</label>
              <input
                id="correction-source"
                type="url"
                value={form.supportingSourceUrl}
                onChange={event => update('supportingSourceUrl', event.target.value)}
                placeholder="https://www.parliament.lk/..."
                aria-invalid={fieldError('supportingSourceUrl') ? 'true' : undefined}
                aria-describedby={fieldError('supportingSourceUrl') ? 'error-source' : 'hint-source'}
              />
              {fieldError('supportingSourceUrl')
                ? <p className="form-error" id="error-source">{fieldError('supportingSourceUrl')}</p>
                : <p className="form-hint" id="hint-source">{t('corrections.sourceUrlHint')}</p>}
            </div>

            <div className="form-field form-field--wide">
              <label htmlFor="correction-explanation">{t('corrections.explanationLabel')} <span className="form-optional">{t('corrections.explanationOptional')}</span></label>
              <textarea
                id="correction-explanation"
                rows={4}
                value={form.explanation}
                onChange={event => update('explanation', event.target.value)}
                placeholder={t('corrections.explanationPlaceholder')}
              />
            </div>
          </div>

          <div className="u-mt-5">
            <button
              type="submit"
              className="btn btn--primary"
              disabled={submission?.state === 'sending'}
            >
              {connected
                ? (submission?.state === 'sending' ? t('corrections.sending') : t('corrections.submitReport'))
                : t('corrections.validateReport')}
            </button>
          </div>
        </form>

        <div ref={resultRef} tabIndex={-1} className="u-mt-8" aria-live="polite">
          {errors ? <Notice
            tone="warning"
            iconName="alert"
            title={t('corrections.incompleteTitle')}
            body={Object.values(errors)}
            className="notice--result"
          /> : null}

          {submission?.state === 'filed' ? <Notice
            iconName="shieldCheck"
            title={submission.duplicate ? t('corrections.alreadyReported') : t('corrections.reportReceived')}
            body={[
              submission.duplicate ? t('corrections.alreadyReportedBody') : t('corrections.reportReceivedBody'),
              t('corrections.referenceLabel', { id: submission.id }),
            ]}
            className="notice--result"
          /> : null}

          {submission?.state === 'failed' ? <Notice
            tone="warning"
            iconName="alert"
            title={t('corrections.reportNotFiledTitle')}
            body={[submission.message, retryHint(t, submission.retryAfterSeconds)].filter(Boolean)}
            className="notice--result"
          /> : null}

          {payload ? <>
            <Notice
              iconName="info"
              title={t('corrections.validatedNotSubmittedTitle')}
              body={[t('corrections.validatedNotSubmittedBody')]}
              className="notice--result"
            />
            <div className="panel u-mt-5">
              <h3 className="policy__title"><Icon name="document"/><span>{t('corrections.structuredReport')}</span></h3>
              <pre className="code-block"><code>{JSON.stringify(payload, null, 2)}</code></pre>
            </div>
          </> : null}
        </div>

        <div className="u-mt-8">
          {/* Conditional for the same reason the notice above is: with a
              channel connected these are the states a report really moves
              through, and calling that hypothetical would understate what
              submitting actually does. */}
          <SectionHead
            title={connected ? t('corrections.howHandledConnected') : t('corrections.howHandledDisconnected')}
            description={connected ? t('corrections.reviewStatesConnected') : t('corrections.reviewStatesDisconnected')}
          />
          <ol className="record-list workflow-list">
            {[
              [t('corrections.stepOpenTitle'), t('corrections.stepOpenBody')],
              [t('corrections.stepReviewTitle'), t('corrections.stepReviewBody')],
              [t('corrections.stepDecisionTitle'), t('corrections.stepDecisionBody')],
              [t('corrections.stepPublishedTitle'), t('corrections.stepPublishedBody')],
            ].map(([title, body]) => (
              <li key={title}><article className="record-row">
                <div className="record-row__main">
                  <h3 className="record-row__title">{title}</h3>
                  <p className="record-row__institution">{body}</p>
                </div>
              </article></li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  </>;
}
