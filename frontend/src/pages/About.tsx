import { BookOpen, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { TareStory } from '../components/TareStory'
import { TareWordmark } from '../components/TareWordmark'
import { DISCLAIMER } from '../lib/targets'

type Version = { version: string; mail: boolean }

// What this is, where its numbers come from, and who made it. The version is
// the server's, never package.json: what a member is looking at is whatever
// the instance is running.
export function About({ onOpenGuide }: { onOpenGuide: () => void }) {
  const [version, setVersion] = useState('')

  useEffect(() => {
    let alive = true
    api<Version>('/version')
      .then((instance) => alive && setVersion(instance.version))
      // An instance that will not say leaves the line off rather than
      // guessing at a number.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <div className="t-card mb-3">
        <p className="flex">
          <TareWordmark size={22} />
        </p>
        {version !== '' && <p className="mt-1 text-sm text-muted">Version {version}</p>}
      </div>

      <TareStory />

      <div className="t-card mb-3">
        <p className="t-micro mb-2">How it works</p>
        <p className="text-sm">
          The barcode scanner first searches the Tare database for existing items. If it
          doesn't exist, it searches Open Food Facts, whose data is available under the Open
          Database License (ODbL). Once an item is approved, it's stored on Tare's server and
          doesn't have to reach out to the internet.
        </p>
        <p className="mt-3 text-sm">
          Calorie and nutrient targets follow the Dietary Guidelines for Americans and the
          American Heart Association. {DISCLAIMER}
        </p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Team Tare</p>
        <p className="text-sm">
          Tare is built & maintained by{' '}
          <a
            className="text-accent"
            href="https://lazaruslinux.com"
            target="_blank"
            rel="noopener"
          >
            Lazarus Labs
          </a>
          . This project was built with Claude Code, an agentic coding platform, through hundreds of
          human iterations and thousands of prompts.
        </p>
        <p className="t-note mt-3">Tare is open-source under the AGPL-3.0 license.</p>
      </div>

      <div className="t-card mb-3">
        <button type="button" className="t-row w-full text-left" onClick={onOpenGuide}>
          <BookOpen className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-sm">Guide</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </button>
      </div>
    </>
  )
}
