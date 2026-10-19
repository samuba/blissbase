------------------------ MODULE EventDeleteOutbox ------------------------
(***************************************************************************
 * Model of cleanupDeletedEvents / deleteOrphanedEventImages racing with
 * scrape delete+reinsert of the same image URL.
 *
 * Code under check:
 *   src/routes/api/cron/cleanupDeletedEvents/+server.ts
 *     GET cron drain loop
 *     deleteOrphanedEventImages
 *   DELETE on events enqueues event_deleted_outbox
 *   scrapers that delete then upsert events reusing image URLs
 *
 * Property: a URL still referenced by any live event is never deleted
 * from R2 / imageCacheMap.
 *
 * Harm: mass broken event covers when scrape reuses URLs after delete.
 *
 * Bounds: 2 URLs, 2 event slots, 2 outbox slots, clock 0..MaxNow.
 * MinAge stands for MIN_AGE_MS (1h). SkipStillUsedCheck = 1 models
 * removing the usedUrls filter in deleteOrphanedEventImages.
 ***************************************************************************)
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS
  Urls,
  EventSlots,
  OutboxSlots,
  MaxNow,
  MinAge,
  MaxAttempts,
  SkipStillUsedCheck

VARIABLES
  live,       \* [EventSlots -> SUBSET Urls]
  r2,         \* SUBSET Urls in object storage
  cache,      \* SUBSET Urls in imageCacheMap
  outbox,     \* [OutboxSlots -> row]; free slot has status "empty"
  now

vars == <<live, r2, cache, outbox, now>>

Statuses == {"empty", "pending", "done", "failed"}

EmptyRow == [
  status |-> "empty",
  created |-> 0,
  urls |-> {},
  attempts |-> 0
]

TypeOK ==
  /\ live \in [EventSlots -> SUBSET Urls]
  /\ r2 \subseteq Urls
  /\ cache \subseteq Urls
  /\ outbox \in [OutboxSlots -> [
       status: Statuses,
       created: 0..MaxNow,
       urls: SUBSET Urls,
       attempts: 0..MaxAttempts
     ]]
  /\ now \in 0..MaxNow

UsedUrls == UNION {live[e] : e \in EventSlots}

FreeOutbox == {s \in OutboxSlots : outbox[s].status = "empty"}

----------------------------------------------------------------------------
Init ==
  /\ live = [e \in EventSlots |-> {}]
  /\ r2 = {}
  /\ cache = {}
  /\ outbox = [s \in OutboxSlots |-> EmptyRow]
  /\ now = 0

CreateEvent(e, u) ==
  /\ live[e] = {}
  /\ live' = [live EXCEPT ![e] = {u}]
  /\ r2' = r2 \cup {u}
  /\ cache' = cache \cup {u}
  /\ UNCHANGED <<outbox, now>>

\* DB DELETE → trigger enqueues pending outbox row with event.image_urls.
DeleteEvent(e) ==
  /\ live[e] # {}
  /\ FreeOutbox # {}
  /\ LET urls == live[e]
         s == CHOOSE x \in FreeOutbox : TRUE
     IN
       /\ live' = [live EXCEPT ![e] = {}]
       /\ outbox' = [outbox EXCEPT ![s] = [
            status |-> "pending",
            created |-> now,
            urls |-> urls,
            attempts |-> 0
          ]]
  /\ UNCHANGED <<r2, cache, now>>

\* Scrape re-inserts an event reusing a URL still in R2.
ScrapeReinsert(e, u) ==
  /\ live[e] = {}
  /\ u \in r2
  /\ live' = [live EXCEPT ![e] = {u}]
  /\ UNCHANGED <<r2, cache, outbox, now>>

Tick ==
  /\ now < MaxNow
  /\ now' = now + 1
  /\ UNCHANGED <<live, r2, cache, outbox>>

OrphanedUrls(imageUrls) ==
  IF SkipStillUsedCheck = 1
  THEN imageUrls
  ELSE {u \in imageUrls : u \notin UsedUrls}

\* Success path: deleteOrphanedEventImages then mark done.
\* Done rows are dropped to empty here (retention is out of scope).
ProcessPending(s) ==
  /\ outbox[s].status = "pending"
  /\ now >= outbox[s].created + MinAge
  /\ LET orphaned == OrphanedUrls(outbox[s].urls)
     IN
       /\ r2' = r2 \ orphaned
       /\ cache' = cache \ orphaned
       /\ outbox' = [outbox EXCEPT ![s] = EmptyRow]
       /\ UNCHANGED <<live, now>>

\* Shared cleanup failure: bump attempts; failed at MaxAttempts.
FailPending(s) ==
  /\ outbox[s].status = "pending"
  /\ now >= outbox[s].created + MinAge
  /\ LET attemptsPrime == outbox[s].attempts + 1
     IN
       /\ IF attemptsPrime >= MaxAttempts
          THEN outbox' = [outbox EXCEPT ![s] = EmptyRow]
          ELSE outbox' = [outbox EXCEPT ![s].attempts = attemptsPrime]
       /\ UNCHANGED <<live, r2, cache, now>>

Next ==
  \/ \E e \in EventSlots, u \in Urls : CreateEvent(e, u)
  \/ \E e \in EventSlots : DeleteEvent(e)
  \/ \E e \in EventSlots, u \in Urls : ScrapeReinsert(e, u)
  \/ Tick
  \/ \E s \in OutboxSlots : ProcessPending(s)
  \/ \E s \in OutboxSlots : FailPending(s)

Spec == Init /\ [][Next]_vars

LiveImagesPreserved ==
  /\ UsedUrls \subseteq r2
  /\ UsedUrls \subseteq cache

============================================================================
)
