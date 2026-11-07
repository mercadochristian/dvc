import styles from './checkout-wizard.module.css'

const phases = ['Players', 'Contact', 'Review', 'Payment'] as const
type Phase = typeof phases[number]

export function CheckoutProgress({ phase, links }: { phase: Phase; links?: Partial<Record<Phase, () => void>> }) {
  return <ol className={styles.progress} aria-label="Registration progress">{phases.map(label => <li key={label} aria-current={label === phase ? 'step' : undefined}>{label !== phase && links?.[label] ? <button type="button" onClick={links[label]}>{label}</button> : <span>{label}</span>}</li>)}</ol>
}
