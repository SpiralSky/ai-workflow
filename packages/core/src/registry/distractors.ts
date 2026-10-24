import type { Registry, ToolDecl } from "./types.ts";

/** A business domain: tool-name noun, how it reads in prose, who handles it, and its real fields (camelCase parameter names). */
interface Domain {
  noun: string;
  one: string;
  many: string;
  who: string;
  fields: string[];
}

const d = (noun: string, one: string, many: string, who: string, fields: string): Domain => ({ noun, one, many, who, fields: fields.split(" ") });

/** The fixed domains; each has its own vocabulary so tools of different domains share few terms. */
const DOMAINS: Domain[] = [
  d("Invoice", "invoice", "invoices", "accountant", "dueDate lineItems taxRate customerName currency paymentTerms"),
  d("CalendarEvent", "calendar event", "calendar events", "organiser", "startTime endTime attendees reminderMinutes recurrence timeZone"),
  d("SupportTicket", "support ticket", "support tickets", "support agent", "priority requesterEmail queue escalationLevel firstResponseDue channel"),
  d("Playlist", "playlist", "playlists", "listener", "trackCount albumTitle shuffleMode coverImage collaborators genre"),
  d("Shipment", "shipment", "shipments", "dispatcher", "carrier trackingNumber destinationAddress parcelWeight estimatedDelivery serviceLevel"),
  d("InventoryItem", "inventory item", "inventory items", "warehouse clerk", "sku shelfLocation quantityOnHand reorderPoint unitCost supplierCode"),
  d("PurchaseOrder", "purchase order", "purchase orders", "procurement officer", "vendorName orderTotal approvalStatus deliveryDate costCenter paymentMethod"),
  d("ExpenseReport", "expense report", "expense reports", "employee", "receiptCount reimbursementTotal tripPurpose submittedOn mileageKm approver"),
  d("Timesheet", "timesheet", "timesheets", "team lead", "weekEnding hoursWorked overtimeHours projectCode shiftPattern breakMinutes"),
  d("JobPosting", "job posting", "job postings", "recruiter", "jobTitle salaryRange employmentType applicationDeadline remotePolicy hiringManager"),
  d("Newsletter", "newsletter", "newsletters", "marketer", "subjectLine sendTime audienceSegment openRate templateName unsubscribeLink"),
  d("SocialPost", "social media post", "social media posts", "community manager", "caption hashtags publishTime platform mediaUrl engagementCount"),
  d("AdCampaign", "ad campaign", "ad campaigns", "media buyer", "dailyBudget bidStrategy targetAudience impressionCap landingUrl conversionGoal"),
  d("Coupon", "discount coupon", "discount coupons", "promotions manager", "couponCode percentOff expiryDate usageLimit minimumSpend eligibleProducts"),
  d("Subscription", "subscription", "subscriptions", "billing specialist", "planName renewalDate trialDays billingInterval seatCount cancellationReason"),
  d("Refund", "refund", "refunds", "payments analyst", "orderNumber refundAmount refundReason cardLast4 processedOn restockItems"),
  d("BankAccount", "bank account", "bank accounts", "treasurer", "accountNumber currentBalance overdraftLimit statementMonth sortCode accountHolder"),
  d("TaxFiling", "tax filing", "tax filings", "tax preparer", "fiscalYear grossRevenue deductions filingStatus jurisdiction dueDate"),
  d("Contract", "contract", "contracts", "legal counsel", "counterparty effectiveDate renewalClause signatories governingLaw noticePeriod"),
  d("MeetingRoom", "meeting room", "meeting rooms", "office manager", "buildingFloor seatCapacity projectorAvailable bookingSlot roomEquipment cateringOption"),
  d("FlightBooking", "flight booking", "flight bookings", "travel coordinator", "airlineCode departureAirport arrivalAirport seatClass passengerName baggageAllowance"),
  d("HotelReservation", "hotel reservation", "hotel reservations", "front desk agent", "guestName checkInDate checkOutDate roomType ratePlan specialRequests"),
  d("RideRequest", "ride request", "ride requests", "dispatcher", "pickupLocation dropoffLocation vehicleType fareEstimate passengerCount scheduledPickup"),
  d("Recipe", "recipe", "recipes", "home cook", "ingredients servings prepMinutes cuisine dietaryTags cookingMethod"),
  d("MealPlan", "meal plan", "meal plans", "nutritionist", "dailyCalories mealsPerDay allergyList startWeek groceryBudget macroTargets"),
  d("WorkoutRoutine", "workout routine", "workout routines", "personal trainer", "exerciseList setsPerExercise repRange restSeconds muscleGroup difficultyLevel"),
  d("Prescription", "prescription", "prescriptions", "pharmacist", "medicationName dosageMg refillsRemaining prescribingDoctor patientId pharmacyBranch"),
  d("ClinicVisit", "clinic visit", "clinic visits", "receptionist", "patientName visitReason attendingNurse appointmentSlot insuranceProvider followUpDate"),
  d("WeatherAlert", "weather alert", "weather alerts", "duty forecaster", "severityLevel affectedRegion alertType validUntil windSpeedKph advisoryText"),
  d("StockQuote", "stock quote", "stock quotes", "portfolio manager", "tickerSymbol lastPrice dayVolume exchangeCode dividendYield quoteCurrency"),
  d("CryptoWallet", "crypto wallet", "crypto wallets", "custodian", "walletAddress tokenBalance networkName withdrawalLimit seedBackupStatus gasFeeCap"),
  d("PodcastEpisode", "podcast episode", "podcast episodes", "producer", "episodeNumber guestName runtimeMinutes transcriptUrl showNotes publishDate"),
  d("PhotoAlbum", "photo album", "photo albums", "photographer", "albumTitle photoCount cameraModel shotDate sharedWith filterPreset"),
  d("VideoClip", "video clip", "video clips", "video editor", "frameRate durationSeconds captionTrack resolution renderPreset thumbnailFrame"),
  d("LoyaltyCard", "loyalty card", "loyalty cards", "retail associate", "memberTier pointsBalance joinDate rewardsEarned partnerStores expiryPolicy"),
  d("Reservation", "restaurant reservation", "restaurant reservations", "maitre d'", "partySize tableNumber seatingTime dietaryNotes occasion depositAmount"),
  d("Survey", "survey", "surveys", "research analyst", "questionCount respondentTarget closingDate anonymousMode sampleQuota thankYouMessage"),
  d("Webinar", "webinar", "webinars", "event host", "presenterName registrantLimit slidesUrl recordingEnabled startsAt replayExpiry"),
  d("Classroom", "classroom", "classrooms", "teacher", "gradeLevel syllabusUrl studentRoster homeworkDue termName lessonCount"),
  d("LibraryBook", "library book", "library books", "librarian", "isbn authorName borrowerCard dueBack shelfMark editionYear"),
  d("RealEstateListing", "property listing", "property listings", "estate agent", "askingPrice bedroomCount floorAreaSqm viewingDate neighbourhood mortgageEligible"),
  d("VehicleService", "vehicle service", "vehicle services", "service advisor", "licensePlate odometerKm repairItems mechanicName warrantyCovered pickupBy"),
  d("ParkingPermit", "parking permit", "parking permits", "permit officer", "plateNumber zoneCode validFrom vehicleClass residentProof renewalFee"),
  d("EnergyMeter", "energy meter", "energy meters", "utility operator", "meterReadingKwh tariffName billingPeriod peakDemandKw gridRegion serviceAddress"),
  d("Donation", "donation", "donations", "fundraiser", "donorName pledgeAmount campaignName giftAid recurringSchedule dedication"),
  d("InsuranceClaim", "insurance claim", "insurance claims", "claims adjuster", "policyNumber incidentDate damageEstimate coverageType claimantName deductible"),
  d("EventTicket", "event ticket", "event tickets", "box office clerk", "venueName seatBlock admissionType showDate faceValue barcode"),
  d("PetProfile", "pet profile", "pet profiles", "kennel manager", "breed vaccinationDate ownerContact weightKg microchipId feedingSchedule"),
  d("GardenPlot", "garden plot", "garden plots", "head gardener", "plotSize soilType wateringSchedule plantedSeeds harvestWindow sunExposure"),
  d("Translation", "translation job", "translation jobs", "project linguist", "sourceLanguage targetLanguage wordCount glossaryId turnaroundHours reviewerNotes"),
  d("SecurityBadge", "security badge", "security badges", "security officer", "holderName accessLevel doorGroups visitorHost issuedAt lostReportedAt"),
  d("Warranty", "warranty", "warranties", "after-sales agent", "serialNumber purchaseDate coverageMonths defectReport proofOfPurchase transferable"),
];

/** Per-tool text: `desc` is the description, `when` the situation to call it, `not` an optional redirect to a sibling verb. */
type Wording = { desc: string; when: string; not?: [sibling: string, reason: string] };

/** Wording context: the domain's prose forms plus three fields picked for this tool. */
interface Ctx {
  one: string;
  many: string;
  who: string;
  a: string;
  b: string;
  c: string;
}

/** Verb stem, effect and a wording function (reads naturally for any domain). */
const VERBS: [verb: string, effect: ToolDecl["meta"]["effect"], word: (x: Ctx) => Wording][] = [
  ["list", "read", (x) => ({ desc: `Lists ${x.many}, optionally filtered by ${x.a} or ${x.b}.`, when: `Use to browse ${x.many} before choosing one, for example everything sharing a ${x.a}.`, not: ["get", `you already know which ${x.one} you need`] })],
  ["get", "read", (x) => ({ desc: `Fetches the full record of one ${x.one}, including its ${x.a}, ${x.b} and ${x.c}.`, when: `Use when you have the id of a ${x.one} and need its current details.`, not: ["list", `you want several ${x.many} at once`] })],
  ["search", "read", (x) => ({ desc: `Finds ${x.many} whose ${x.a} or ${x.b} matches a text query.`, when: `Use when the id is unknown but you remember part of the ${x.a}.`, not: ["get", `the id of the ${x.one} is already known`] })],
  ["summarize", "read", (x) => ({ desc: `Summarises ${x.many} into totals grouped by ${x.a}.`, when: `Use for a quick report on ${x.many} by ${x.a} and ${x.b}, for instance at the end of the month.`, not: ["list", "you need the individual records"] })],
  ["export", "read", (x) => ({ desc: `Exports ${x.many} with their ${x.a}, ${x.b} and ${x.c} as a CSV file.`, when: `Use when a ${x.who} wants a spreadsheet of ${x.many} to share offline.`, not: ["summarize", "only totals are needed"] })],
  ["validate", "read", (x) => ({ desc: `Checks a ${x.one} for missing or inconsistent ${x.a} and ${x.b} without saving anything.`, when: `Call before submitting a ${x.one} to catch mistakes early.`, not: ["update", "you actually want to change the record"] })],
  ["create", "write", (x) => ({ desc: `Creates a new ${x.one} with the given ${x.a} and ${x.b}.`, when: `Use when a ${x.who} needs to record a ${x.one} that does not exist yet.`, not: ["update", `the ${x.one} already exists`] })],
  ["update", "write", (x) => ({ desc: `Changes the ${x.a}, ${x.b} or ${x.c} of an existing ${x.one}.`, when: `Use to correct or revise a ${x.one} that is already recorded.`, not: ["create", `the ${x.one} is new`] })],
  ["delete", "write", (x) => ({ desc: `Permanently deletes a ${x.one}; this cannot be undone.`, when: `Use only for a ${x.one} that was entered by mistake.`, not: ["archive", `the ${x.one} should stay on record`] })],
  ["archive", "write", (x) => ({ desc: `Archives a ${x.one} so it disappears from active ${x.many} but keeps its history.`, when: `Use once a ${x.one} is finished and its ${x.a} must be kept for the record.`, not: ["delete", "it should be removed entirely"] })],
  ["duplicate", "write", (x) => ({ desc: `Copies an existing ${x.one}, reusing its ${x.a} and ${x.b}.`, when: `Use to start a similar ${x.one} without retyping the details.`, not: ["create", "you are starting from scratch"] })],
  ["assign", "write", (x) => ({ desc: `Assigns a ${x.one} to a ${x.who} who becomes responsible for its ${x.a}.`, when: `Use when a ${x.one} has no owner or responsibility is changing hands.`, not: ["update", `you are editing other fields of the ${x.one}`] })],
  ["tag", "write", (x) => ({ desc: `Adds or removes labels on a ${x.one} to group it, for example by ${x.a}.`, when: `Use to organise ${x.many} so they are easy to find later.`, not: ["update", "the change is not about labels"] })],
  ["restore", "write", (x) => ({ desc: `Brings back an archived or deleted ${x.one} with its ${x.a} and ${x.b} intact.`, when: `Use when a ${x.one} was removed by accident or is needed again.`, not: ["create", `you want a brand new ${x.one}`] })],
  ["import", "write", (x) => ({ desc: `Bulk-loads ${x.many} from a CSV file, mapping columns to ${x.a}, ${x.b} and ${x.c}.`, when: `Use when migrating many ${x.many} from another system in one go.`, not: ["create", `only one ${x.one} is being added`] })],
  ["merge", "write", (x) => ({ desc: `Merges two duplicate ${x.many} into one, keeping the ${x.a} of the primary.`, when: `Use after discovering that the same ${x.one} was recorded twice.`, not: ["delete", "the records are not true duplicates"] })],
  ["share", "external", (x) => ({ desc: `Shares a ${x.one} by email with someone outside the team so they can view its ${x.a}.`, when: `Use when a ${x.who} must give an outside party read access.`, not: ["export", "a file copy is enough"] })],
  ["schedule", "external", (x) => ({ desc: `Schedules a future action on a ${x.one}, such as a change to its ${x.a}, for a chosen date and time.`, when: `Use when the work should happen later rather than now.`, not: ["update", "the change should apply immediately"] })],
  ["cancel", "external", (x) => ({ desc: `Cancels a pending ${x.one} and informs everyone affected by the ${x.a}.`, when: `Use when a ${x.one} will no longer go ahead.`, not: ["delete", "no notification is wanted"] })],
  ["approve", "external", (x) => ({ desc: `Approves a submitted ${x.one} after review of its ${x.a} and ${x.b}.`, when: `Use when a ${x.who} or manager is ready to sign off.`, not: ["validate", "you only want to check it first"] })],
  ["notify", "external", (x) => ({ desc: `Sends a notification about a ${x.one} to the ${x.who} and other followers.`, when: `Use to alert people to a change in the ${x.a} or ${x.b}.`, not: ["share", "recipients need access, not just a message"] })],
  ["escalate", "external", (x) => ({ desc: `Escalates an overdue ${x.one} to a manager and flags its ${x.a}.`, when: `Use when a ${x.one} is stuck and the normal ${x.who} has not acted.`, not: ["assign", "a simple reassignment is enough"] })],
  ["reopen", "write", (x) => ({ desc: `Reopens a closed ${x.one} so its ${x.a} can be revised.`, when: `Use when new information shows a finished ${x.one} needs more work.`, not: ["restore", "the record was deleted rather than closed"] })],
  ["rate", "write", (x) => ({ desc: `Records a score and a short comment for a ${x.one}, judging its ${x.a}.`, when: `Use after a ${x.one} is complete to capture feedback.`, not: ["update", "no score is involved"] })],
];

/** Splits a camelCase field name into lowercase words (`dueDate` -> `due date`). */
const words = (f: string) => f.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** Fixes English articles in generated prose (`a inventory item` -> `an inventory item`). */
const grammar = (s: string) => s.replace(/\ba(?= [aeiou])/g, "an");

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * The fixed distractor set (orchestrate §10.2): plausible business tools no coding problem needs.
 * Generation is deterministic: index i -> domain i mod D and verb floor(i / D); which of the domain's
 * fields a tool mentions depends only on its verb round. So the first N are identical in every
 * run (no randomness) and a larger N extends a smaller one. Each domain has its own vocabulary, so tools of
 * different domains share few terms.
 * @param count - how many distractors
 * @param taken - names to avoid (the real catalog); a collision gets a trailing `X`
 * @returns tool declarations with routing `routed`; host name `distractor__<name>`
 */
export function distractorDecls(count: number, taken: ReadonlySet<string> = new Set()): ToolDecl[] {
  const out: ToolDecl[] = [];
  const used = new Set(taken);
  for (let i = 0; out.length < count; i++) {
    const dom = DOMAINS[i % DOMAINS.length]!;
    const round = Math.floor(i / DOMAINS.length);
    const [verb, effect, word] = VERBS[round % VERBS.length]!;
    const generation = Math.floor(round / VERBS.length);
    let name = verb + dom.noun + (generation ? generation + 1 : "");
    while (used.has(name)) name += "X";
    used.add(name);
    // sibling verbs of one domain start at different fields so their wording differs
    const n = dom.fields.length;
    const start = (round * 5 + Math.floor(round / 2)) % n;
    const picked = [0, 1 + (round % 2), 3 + (round % 3)].map((k) => dom.fields[(start + k) % n]!);
    const [a, b, c] = picked.map(words) as [string, string, string];
    const w = word({ one: dom.one, many: dom.many, who: dom.who, a, b, c });
    const properties: Record<string, { type: string; description: string }> = { id: { type: "string", description: `${cap(dom.one)} identifier` } };
    for (const f of picked.slice(0, 2)) {
      properties[f] = { type: /count|total|amount|rate|price|limit|balance|minutes|hours|seconds|weight|size|cap/i.test(f) ? "number" : "string", description: `${cap(words(f))} of the ${dom.one}` };
    }
    out.push({
      name,
      hostName: `distractor__${name}`,
      description: grammar(w.desc),
      parameters: { type: "object", properties, required: ["id"] },
      returns: "unknown",
      routing: "routed",
      capsOutput: false,
      meta: {
        whenToUse: grammar(w.when),
        ...(w.not ? { whenNotToUse: grammar(`Use ${w.not[0]}${dom.noun} when ${w.not[1]}.`) } : {}),
        effect,
        examples: [`${verb} ${dom.one} by ${a}`],
      },
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
