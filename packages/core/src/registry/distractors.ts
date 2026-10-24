import type { Registry, ToolDecl } from "./types.ts";

/** A fixed business-domain entity: the tool-name noun and words that keep its tools distinct from other domains. */
const DOMAINS: [noun: string, words: string][] = [
  ["Invoice", "billing amount due customer payment terms"], ["CalendarEvent", "calendar attendees reminder time slot"],
  ["SupportTicket", "helpdesk priority agent queue escalation"], ["Playlist", "music tracks listeners shuffle album"],
  ["Shipment", "parcel carrier tracking delivery address"], ["InventoryItem", "stock warehouse sku shelf quantity"],
  ["PurchaseOrder", "supplier vendor procurement approval items"], ["ExpenseReport", "receipts reimbursement travel employee claim"],
  ["Timesheet", "hours payroll shifts overtime staff"], ["JobPosting", "hiring vacancy recruiter salary applicants"],
  ["Newsletter", "subscribers mailing campaign open rate digest"], ["SocialPost", "followers hashtag engagement feed scheduling"],
  ["AdCampaign", "impressions clicks bidding audience budget"], ["Coupon", "discount promo redemption checkout code"],
  ["Subscription", "plan renewal trial churn recurring"], ["Refund", "chargeback returned order reversal dispute"],
  ["BankAccount", "balance statement transfer ledger overdraft"], ["TaxFiling", "return deduction fiscal bracket revenue"],
  ["Contract", "clauses signatories counterparty renewal legal"], ["MeetingRoom", "capacity projector floor booking building"],
  ["FlightBooking", "airline seat boarding passenger itinerary"], ["HotelReservation", "guest nights suite check-in concierge"],
  ["RideRequest", "driver pickup fare passenger route"], ["Recipe", "ingredients cooking servings cuisine kitchen"],
  ["MealPlan", "calories nutrition menu diet groceries"], ["WorkoutRoutine", "exercise sets reps trainer fitness"],
  ["Prescription", "pharmacy dosage patient refill doctor"], ["ClinicVisit", "physician diagnosis nurse waiting clinic"],
  ["WeatherAlert", "forecast storm region meteorology warning"], ["StockQuote", "ticker shares exchange dividend portfolio"],
  ["CryptoWallet", "blockchain coins seed address exchange"], ["PodcastEpisode", "host episode listeners transcript guest"],
  ["PhotoAlbum", "pictures gallery camera lens filter"], ["VideoClip", "footage editor timeline render captions"],
  ["LoyaltyCard", "points rewards members tier perks"], ["Reservation", "restaurant diners table waiter seating"],
  ["Survey", "respondents questions poll responses sample"], ["Webinar", "presenter registrants slides recording audience"],
  ["Classroom", "students teacher lesson syllabus homework"], ["LibraryBook", "borrower catalog author isbn checkout"],
  ["RealEstateListing", "property realtor bedrooms mortgage viewing"], ["VehicleService", "mechanic odometer garage repairs warranty"],
  ["ParkingPermit", "licence plate zone municipal garage"], ["EnergyMeter", "kilowatt utility tariff consumption grid"],
  ["Donation", "charity donor fundraiser pledge nonprofit"], ["InsuranceClaim", "policyholder adjuster premium coverage incident"],
  ["EventTicket", "venue concert seat admission festival"], ["PetProfile", "veterinarian breed vaccination owner kennel"],
  ["GardenPlot", "seeds soil watering harvest greenhouse"], ["Translation", "linguist locale glossary source language"],
  ["SecurityBadge", "access door visitor lobby clearance"], ["Warranty", "serial purchase defect coverage period"],
];

/** Verbs with a distinguishing gloss, so tools of one domain differ in wording. */
const VERBS: [verb: string, gloss: string, effect: ToolDecl["meta"]["effect"]][] = [
  ["list", "Lists all known", "read"], ["get", "Fetches the full details of one", "read"], ["search", "Finds by keyword among the", "read"],
  ["summarize", "Produces a short digest covering the", "read"], ["export", "Writes out a spreadsheet file of the", "read"],
  ["validate", "Checks the consistency rules of a", "read"], ["create", "Opens a brand new", "write"],
  ["update", "Edits fields of an existing", "write"], ["delete", "Permanently removes a", "write"],
  ["archive", "Moves a finished one into cold storage:", "write"], ["duplicate", "Makes an identical copy of a", "write"],
  ["assign", "Hands responsibility for a", "write"], ["tag", "Attaches labels to a", "write"],
  ["restore", "Brings back a previously removed", "write"], ["import", "Loads many records from a file into the", "write"],
  ["merge", "Combines two entries into one for the", "write"], ["share", "Grants other people access to a", "external"],
  ["schedule", "Plans a future run concerning a", "external"], ["cancel", "Withdraws a pending", "external"],
  ["approve", "Signs off on a submitted", "external"], ["notify", "Sends a message to everyone involved in a", "external"],
  ["escalate", "Raises urgency of a stuck", "external"], ["reopen", "Reactivates a closed", "write"],
  ["rate", "Records a score for a", "write"],
];

const lower = (s: string) => s[0]!.toLowerCase() + s.slice(1);

/**
 * The fixed distractor set (orchestrate §10.2): plausible business tools no coding problem needs.
 * Generation is deterministic (index i -> domain i mod D, verb floor(i / D)), so the first N are
 * identical in every run and a larger N extends a smaller one.
 * @param count - how many distractors
 * @param taken - names to avoid (the real catalog); a collision gets a numeric suffix
 * @returns tool declarations with routing `routed`; host name `distractor__<name>`
 */
export function distractorDecls(count: number, taken: ReadonlySet<string> = new Set()): ToolDecl[] {
  const out: ToolDecl[] = [];
  const used = new Set(taken);
  for (let i = 0; out.length < count; i++) {
    const [noun, words] = DOMAINS[i % DOMAINS.length]!;
    const round = Math.floor(i / DOMAINS.length);
    const [verb, gloss, effect] = VERBS[round % VERBS.length]!;
    const generation = Math.floor(round / VERBS.length);
    const compact = noun.replace(/\s+/g, "");
    let name = verb + compact + (generation ? generation + 1 : "");
    while (used.has(name)) name += "X";
    used.add(name);
    const description = `${gloss} ${lower(compact)} (${words}).`;
    out.push({
      name,
      hostName: `distractor__${name}`,
      description,
      parameters: { type: "object", properties: { id: { type: "string", description: `${compact} identifier` } }, required: ["id"] },
      returns: "unknown",
      routing: "routed",
      capsOutput: false,
      meta: { whenToUse: description, effect },
    });
  }
  return out;
}

/**
 * Pads a registry with distractors up to `total` tools (core-tools-and-hosts §6, `catalog=N`).
 * The real tools keep their order and come first. A `total` at or below the real count changes nothing.
 * @param registry - the real registry (not modified)
 * @param total - target number of tools in the catalog
 * @returns a new registry
 */
export function padRegistry(registry: Registry, total: number): Registry {
  const extra = total - registry.decls.length;
  if (extra <= 0) return registry;
  const decls = [...registry.decls, ...distractorDecls(extra, new Set(registry.byName.keys()))];
  return {
    decls,
    byName: new Map(decls.map((d) => [d.name, d])),
    byHostName: new Map(decls.map((d) => [d.hostName, d])),
  };
}
