/**
 * The single source of slide content (brief §5, arch §5.3).
 *
 * DRAFT: every number and status below is written from published trial reports and FDA labelling
 * and has NOT yet been checked line by line against the linked sources by the author. Brief §5
 * requires that check before submission. Items marked "[verify]" in a source label were only
 * confirmed through secondary reports and need the primary document.
 */
export const SLIDE_IDS = ["intro", "mechanism", "uses", "evidence", "safety", "future"] as const;
export type SlideId = (typeof SLIDE_IDS)[number];

export type VisualKey =
  "gut-hormone" | "receptor" | "uses" | "trials" | "adverse-events" | "timeline";

export interface Fact {
  id: string;
  text: string;
  sourceIds: string[];
}
export interface Source {
  id: string;
  label: string;
  url: string;
  accessed: string;
}
export interface Segment {
  text: string;
  bullet: number;
}

export interface Slide {
  id: SlideId;
  title: string;
  summary: string;
  bullets: string[];
  visual: VisualKey;
  segments: Segment[];
  facts: Fact[];
  sources: Source[];
  statusAsOf?: string;
  keywords: string[];
}

const ACCESSED = "2026-10-26";
const src = (id: string, label: string, url: string): Source => ({
  id,
  label,
  url,
  accessed: ACCESSED,
});
const drugsAtFda = (appl: string) =>
  `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${appl}`;

const DRUCKER = src(
  "drucker-2018",
  "Drucker, Cell Metab 2018",
  "https://doi.org/10.1016/j.cmet.2018.03.001",
);
const STEP1 = src("step-1", "STEP-1, Wilding, NEJM 2021", "https://doi.org/10.1056/NEJMoa2032183");
const STEP1_EXT = src(
  "step-1-ext",
  "STEP-1 extension, Wilding, Diabetes Obes Metab 2022 [verify]",
  "https://doi.org/10.1111/dom.14725",
);
const SURMOUNT1 = src(
  "surmount-1",
  "SURMOUNT-1, Jastreboff, NEJM 2022",
  "https://doi.org/10.1056/NEJMoa2206038",
);
const SURMOUNT4 = src(
  "surmount-4",
  "SURMOUNT-4, Aronne, JAMA 2024 [verify]",
  "https://doi.org/10.1001/jama.2023.24945",
);
const SURMOUNT5 = src(
  "surmount-5",
  "SURMOUNT-5, Aronne, NEJM 2025 [verify]",
  "https://doi.org/10.1056/NEJMoa2416394",
);
const SELECT = src("select", "SELECT, Lincoff, NEJM 2023", "https://doi.org/10.1056/NEJMoa2307563");
const SURPASS2 = src(
  "surpass-2",
  "SURPASS-2, Frias, NEJM 2021 [verify]",
  "https://doi.org/10.1056/NEJMoa2107519",
);
const WEGOVY_LABEL = src("fda-wegovy", "FDA label, Wegovy", drugsAtFda("215256"));
const OZEMPIC_LABEL = src("fda-ozempic", "FDA label, Ozempic", drugsAtFda("209637"));
const MOUNJARO_LABEL = src("fda-mounjaro", "FDA label, Mounjaro", drugsAtFda("215866"));
const ZEPBOUND_LABEL = src("fda-zepbound", "FDA label, Zepbound", drugsAtFda("217806"));
const FDA_NOVEL = src(
  "fda-novel-2026",
  "FDA approvals, oral semaglutide (Dec 2025) and orforglipron (Apr 2026) [verify]",
  "https://www.fda.gov/drugs/development-approval-process-drugs/novel-drug-approvals-fda",
);
const ATTAIN1 = src(
  "attain-1",
  "ATTAIN-1, orforglipron phase 3 [verify]",
  "https://clinicaltrials.gov/study/NCT05869903",
);

const RETATRUTIDE = src(
  "retatrutide-trials",
  "ClinicalTrials.gov, retatrutide studies [verify]",
  "https://clinicaltrials.gov/search?term=retatrutide",
);

export const deck: Slide[] = [
  {
    id: "intro",
    title: "What is GLP-1?",
    summary: "GLP-1 is a natural gut hormone that signals fullness and helps control blood sugar.",
    bullets: [
      "Glucagon-like peptide-1 (GLP-1) is released by the gut after eating",
      "It helps the pancreas release insulin when blood sugar is high",
      "It signals fullness to the brain",
      "The body's own GLP-1 is broken down within minutes",
    ],
    visual: "gut-hormone",
    segments: [
      {
        text: "GLP-1, short for glucagon-like peptide-1, is a hormone your gut releases after you eat.",
        bullet: 0,
      },
      {
        text: "It tells the pancreas to release insulin, but only when blood sugar is high.",
        bullet: 1,
      },
      { text: "It also sends a signal of fullness to the brain.", bullet: 2 },
      {
        text: "Your own GLP-1 is broken down by an enzyme within minutes, which is why medicines had to be engineered to last longer.",
        bullet: 3,
      },
    ],
    facts: [
      {
        id: "intro-1",
        text: "GLP-1 (glucagon-like peptide-1) is an incretin hormone secreted by intestinal L-cells in response to food intake.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-2",
        text: "GLP-1 stimulates insulin secretion in a glucose-dependent manner.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-3",
        text: "Native GLP-1 is rapidly inactivated by the enzyme DPP-4, with a half-life of about 2 minutes.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-4",
        text: "GLP-1 is a natural hormone made by the body; it is not a drug in itself.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-5",
        text: "GLP-1 also suppresses the release of glucagon, a hormone that raises blood sugar, in a glucose-dependent manner.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-6",
        text: "GLP-1 acts on the brain to reduce appetite and food intake and to increase the feeling of fullness.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-7",
        text: "GLP-1 and GIP are the two main incretin hormones, released by the gut after a meal; incretins amplify insulin release.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-8",
        text: "GLP-1 slows the rate at which the stomach empties after a meal.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "intro-9",
        text: "GLP-1 receptor agonists are medicines that bind and activate the GLP-1 receptor; the term covers semaglutide and liraglutide, and tirzepatide also activates the GIP receptor.",
        sourceIds: ["drucker-2018", "fda-zepbound"],
      },
    ],
    sources: [DRUCKER, ZEPBOUND_LABEL],
    keywords: ["what is", "stand for", "natural", "hormone", "incretin", "gut", "glp-1"],
  },
  {
    id: "mechanism",
    title: "How the medicines work",
    summary:
      "They mimic GLP-1: insulin up only when glucose is high, glucagon down, slower stomach emptying, less appetite, engineered to last days.",
    bullets: [
      "They mimic GLP-1 and activate its receptor",
      "Insulin rises only when glucose is high, and glucagon falls",
      "Slower stomach emptying and action on brain appetite centres reduce food intake",
      "Engineered to last days, so dosing is weekly",
    ],
    visual: "receptor",
    segments: [
      {
        text: "These medicines are built to mimic GLP-1, so they switch on the same receptor your own hormone uses.",
        bullet: 0,
      },
      {
        text: "In the pancreas that raises insulin only when blood sugar is high and lowers glucagon, so low blood sugar is uncommon with these medicines on their own.",
        bullet: 1,
      },
      { text: "They also slow how quickly the stomach empties.", bullet: 2 },
      {
        text: "And in the brain they act on appetite centres, so hunger is quieter and meals feel more filling.",
        bullet: 2,
      },
      {
        text: "Small chemical changes protect them from the enzyme that destroys natural GLP-1, so one injection lasts about a week.",
        bullet: 3,
      },
    ],
    facts: [
      {
        id: "mech-1",
        text: "GLP-1 receptor agonists mimic native GLP-1 by binding and activating the GLP-1 receptor.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "mech-2",
        text: "In the pancreas they increase insulin secretion only when blood glucose is elevated (glucose-dependent), which differs from insulin itself, which lowers glucose regardless of the starting level.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "mech-3",
        text: "They suppress glucagon secretion in a glucose-dependent manner.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "mech-4",
        text: "They delay gastric emptying, slowing the rate at which food leaves the stomach.",
        sourceIds: ["drucker-2018", "fda-wegovy"],
      },
      {
        id: "mech-5",
        text: "They act on GLP-1 receptors in appetite-regulating regions of the brain, including the hypothalamus and hindbrain, reducing hunger and food intake.",
        sourceIds: ["drucker-2018"],
      },
      {
        id: "mech-6",
        text: "Semaglutide is engineered with changes that resist breakdown by DPP-4 and bind albumin in blood, giving a half-life of about 1 week (approximately 7 days), so it is given once weekly.",
        sourceIds: ["fda-wegovy", "fda-ozempic"],
      },
      {
        id: "mech-7",
        text: "Tirzepatide is a single molecule that activates both the GIP and GLP-1 receptors; its half-life is about 5 days and it is given once weekly.",
        sourceIds: ["fda-mounjaro", "fda-zepbound"],
      },
      {
        id: "mech-8",
        text: "Because insulin release is glucose-dependent, the risk of low blood sugar with these medicines alone is low; the risk rises when they are combined with insulin or a sulfonylurea.",
        sourceIds: ["fda-wegovy", "fda-ozempic"],
      },
      {
        id: "mech-9",
        text: "Semaglutide is started at 0.25 mg once weekly and increased step by step every 4 weeks, reaching 2.4 mg for weight management after 16 weeks, to limit stomach and gut side effects.",
        sourceIds: ["fda-wegovy"],
      },
      {
        id: "mech-10",
        text: "Tirzepatide is started at 2.5 mg once weekly and increased in steps of 2.5 mg after at least 4 weeks.",
        sourceIds: ["fda-zepbound", "fda-mounjaro"],
      },
      {
        id: "mech-11",
        text: "These medicines are given by injection under the skin once a week.",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
    ],
    sources: [DRUCKER, WEGOVY_LABEL, OZEMPIC_LABEL, MOUNJARO_LABEL, ZEPBOUND_LABEL],
    keywords: [
      "how does it work",
      "why eat less",
      "appetite",
      "insulin",
      "glucagon",
      "stomach",
      "weekly",
      "receptor",
      "different from insulin",
    ],
  },
  {
    id: "uses",
    title: "What they're used for",
    summary:
      "Type 2 diabetes, chronic weight management, and lowering cardiovascular risk in some patients; newer dual agonists such as tirzepatide.",
    bullets: [
      "Type 2 diabetes: improving blood sugar control",
      "Chronic weight management in adults with obesity, or overweight plus a weight-related condition",
      "Lowering heart attack and stroke risk in selected adults with heart disease",
      "Dual agonists such as tirzepatide act on GIP and GLP-1 receptors",
    ],
    visual: "uses",
    segments: [
      {
        text: "The first use was type 2 diabetes, where these medicines lower average blood sugar alongside diet and exercise.",
        bullet: 0,
      },
      {
        text: "At higher doses, some are approved for long-term weight management in adults with obesity, or with overweight and a related health condition.",
        bullet: 1,
      },
      {
        text: "Semaglutide is also approved to lower the risk of heart attack and stroke in adults with established heart disease and excess weight.",
        bullet: 2,
      },
      {
        text: "A newer class adds a second gut hormone, GIP, and tirzepatide is the example.",
        bullet: 3,
      },
      {
        text: "Brand names can confuse: Ozempic and Wegovy are both semaglutide, but they are labelled for different uses and doses.",
        bullet: 1,
      },
    ],
    facts: [
      {
        id: "uses-1",
        text: "Ozempic (semaglutide), approved in December 2017, is indicated as an addition to diet and exercise to improve blood sugar control in adults with type 2 diabetes; its maximum dose is 2 mg once weekly.",
        sourceIds: ["fda-ozempic"],
      },
      {
        id: "uses-2",
        text: "Wegovy (semaglutide 2.4 mg once weekly), approved in June 2021, is indicated for chronic weight management in adults with obesity (BMI of 30 or more) or overweight (BMI of 27 or more) with at least 1 weight-related condition, alongside a reduced-calorie diet and increased physical activity.",
        sourceIds: ["fda-wegovy"],
      },
      {
        id: "uses-3",
        text: "In March 2024 the Wegovy label added reducing the risk of major adverse cardiovascular events (cardiovascular death, heart attack, stroke) in adults with established cardiovascular disease and either obesity or overweight.",
        sourceIds: ["fda-wegovy", "select"],
      },
      {
        id: "uses-4",
        text: "Ozempic and Wegovy contain the same active ingredient, semaglutide, but they are labelled for different uses and doses: Ozempic up to 2 mg once weekly for type 2 diabetes, Wegovy 2.4 mg once weekly for weight management and cardiovascular risk reduction.",
        sourceIds: ["fda-ozempic", "fda-wegovy"],
      },
      {
        id: "uses-5",
        text: "Mounjaro (tirzepatide), approved in May 2022, is indicated for adults with type 2 diabetes.",
        sourceIds: ["fda-mounjaro"],
      },
      {
        id: "uses-6",
        text: "Zepbound (tirzepatide), approved in November 2023, is indicated for chronic weight management in adults with obesity, or with overweight and at least 1 weight-related condition.",
        sourceIds: ["fda-zepbound"],
      },
      {
        id: "uses-7",
        text: "Zepbound gained an additional indication for moderate to severe obstructive sleep apnea in adults with obesity in December 2024.",
        sourceIds: ["fda-zepbound"],
      },
      {
        id: "uses-8",
        text: "Tirzepatide is a dual GIP and GLP-1 receptor agonist; GIP (glucose-dependent insulinotropic polypeptide) is a second incretin hormone.",
        sourceIds: ["fda-mounjaro", "fda-zepbound"],
      },
      {
        id: "uses-9",
        text: "In the SURPASS-2 trial in type 2 diabetes, tirzepatide lowered HbA1c by 2.01, 2.24 and 2.30 percentage points at 5, 10 and 15 mg, compared with 1.86 for semaglutide 1 mg, at 40 weeks.",
        sourceIds: ["surpass-2"],
      },
      {
        id: "uses-10",
        text: "These medicines are not approved for type 1 diabetes, and whether any of them is appropriate for a given person is a decision for their clinician.",
        sourceIds: ["fda-ozempic", "fda-wegovy"],
      },
    ],
    sources: [OZEMPIC_LABEL, WEGOVY_LABEL, MOUNJARO_LABEL, ZEPBOUND_LABEL, SELECT, SURPASS2],
    statusAsOf: "2026-10-26",
    keywords: [
      "who is it for",
      "indication",
      "diabetes",
      "obesity",
      "weight",
      "ozempic",
      "wegovy",
      "mounjaro",
      "zepbound",
      "tirzepatide",
      "same",
      "heart",
    ],
  },
  {
    id: "evidence",
    title: "What the evidence shows",
    summary:
      "Landmark results: STEP-1 (semaglutide) and SURMOUNT-1 (tirzepatide) weight loss versus placebo, and the SELECT cardiovascular outcome result.",
    bullets: [
      "STEP-1: semaglutide 2.4 mg, 14.9% weight loss vs 2.4% with placebo at 68 weeks",
      "SURMOUNT-1: tirzepatide up to 20.9% vs 3.1% with placebo at 72 weeks",
      "SELECT: major cardiovascular events 6.5% vs 8.0% with placebo",
      "Separate trials, different populations: not a head-to-head comparison",
    ],
    visual: "trials",
    segments: [
      {
        text: "In STEP-1, adults with obesity but without diabetes lost an average of 14.9 percent of their body weight on semaglutide over 68 weeks, compared with 2.4 percent on placebo.",
        bullet: 0,
      },
      {
        text: "In SURMOUNT-1, tirzepatide at the top dose averaged 20.9 percent over 72 weeks, against 3.1 percent on placebo.",
        bullet: 1,
      },
      { text: "Those are averages, so some people lose more and some lose less.", bullet: 1 },
      {
        text: "In SELECT, over a little more than three years, semaglutide lowered major cardiovascular events from 8.0 to 6.5 percent in adults with heart disease and excess weight.",
        bullet: 2,
      },
      {
        text: "These were separate trials with different people and designs, so they are not a head-to-head comparison.",
        bullet: 3,
      },
    ],
    facts: [
      {
        id: "evid-1",
        text: "STEP-1 randomised 1961 adults with obesity (BMI of 30 or more) or overweight (BMI of 27 or more) with at least 1 weight-related condition, without diabetes, to semaglutide 2.4 mg once weekly or placebo for 68 weeks, both with lifestyle intervention.",
        sourceIds: ["step-1"],
      },
      {
        id: "evid-2",
        text: "In STEP-1, mean body weight change at 68 weeks was -14.9% with semaglutide 2.4 mg versus -2.4% with placebo.",
        sourceIds: ["step-1"],
      },
      {
        id: "evid-3",
        text: "In STEP-1, 86.4% of participants on semaglutide lost 5% or more of body weight, versus 31.5% on placebo.",
        sourceIds: ["step-1"],
      },
      {
        id: "evid-4",
        text: "SURMOUNT-1 randomised 2539 adults with obesity or overweight with at least 1 weight-related condition, without diabetes, to tirzepatide 5, 10 or 15 mg once weekly or placebo for 72 weeks, both with lifestyle intervention.",
        sourceIds: ["surmount-1"],
      },
      {
        id: "evid-5",
        text: "In SURMOUNT-1, mean body weight change at 72 weeks was -15.0% with 5 mg, -19.5% with 10 mg and -20.9% with 15 mg of tirzepatide, versus -3.1% with placebo.",
        sourceIds: ["surmount-1"],
      },
      {
        id: "evid-6",
        text: "In SURMOUNT-1, 50% (10 mg) and 57% (15 mg) of participants on tirzepatide lost 20% or more of body weight, versus 3% on placebo.",
        sourceIds: ["surmount-1"],
      },
      {
        id: "evid-7",
        text: "SELECT randomised 17604 adults aged 45 or older with overweight or obesity and established cardiovascular disease, without diabetes, to semaglutide 2.4 mg once weekly or placebo; mean follow-up was 39.8 months.",
        sourceIds: ["select"],
      },
      {
        id: "evid-8",
        text: "In SELECT, the primary outcome (cardiovascular death, non-fatal heart attack or non-fatal stroke) occurred in 6.5% on semaglutide versus 8.0% on placebo (hazard ratio 0.80, 95% confidence interval 0.72 to 0.90).",
        sourceIds: ["select"],
      },
      {
        id: "evid-9",
        text: "The SELECT difference of 8.0% versus 6.5% is an absolute difference of 1.5 percentage points over the trial.",
        sourceIds: ["select"],
      },
      {
        id: "evid-10",
        text: "In SURMOUNT-5, a head-to-head trial of 72 weeks, tirzepatide produced a mean weight change of -20.2% versus -13.7% with semaglutide in adults with obesity and no diabetes.",
        sourceIds: ["surmount-5"],
      },
      {
        id: "evid-11",
        text: "STEP-1 and SURMOUNT-1 were separate trials with different populations, doses and durations, so their results are not a head-to-head comparison.",
        sourceIds: ["step-1", "surmount-1"],
      },
      {
        id: "evid-12",
        text: "These figures are averages across participants, and individual weight loss varied widely.",
        sourceIds: ["step-1", "surmount-1"],
      },
    ],
    sources: [STEP1, SURMOUNT1, SELECT, SURMOUNT5],
    keywords: [
      "how much weight",
      "weight loss",
      "trial",
      "evidence",
      "step",
      "surmount",
      "select",
      "heart",
      "cardiovascular",
      "placebo",
      "percent",
    ],
  },
  {
    id: "safety",
    title: "Side effects and safety",
    summary:
      "Common stomach and gut effects, rare pancreatitis and gallbladder problems, a thyroid tumour boxed warning, some lean-mass loss, and weight regain after stopping.",
    bullets: [
      "Nausea, vomiting, diarrhea and constipation are common, mostly while the dose is rising",
      "Rarer risks include pancreatitis and gallbladder problems",
      "Boxed warning: thyroid C-cell tumours in rodents; not for those with MTC or MEN 2 history",
      "Some lean mass is lost with fat, and weight often returns after stopping",
    ],
    visual: "adverse-events",
    segments: [
      {
        text: "Stomach and gut effects like nausea, vomiting, diarrhea and constipation are the most common side effects, and they mostly appear while the dose is being raised.",
        bullet: 0,
      },
      {
        text: "In STEP-1, 74.2 percent of people on semaglutide had a gut-related event, compared with 47.9 percent on placebo.",
        bullet: 0,
      },
      {
        text: "Rarer problems include pancreatitis and gallbladder disease, so severe belly pain needs medical attention.",
        bullet: 1,
      },
      {
        text: "There is also a boxed warning about thyroid C-cell tumours seen in rodents, so these medicines are not for people with a personal or family history of medullary thyroid cancer or MEN 2.",
        bullet: 2,
      },
      { text: "Some of the weight lost is lean mass as well as fat.", bullet: 3 },
      {
        text: "And weight often comes back after treatment stops, so stopping is a decision to make with a clinician.",
        bullet: 3,
      },
    ],
    facts: [
      {
        id: "safe-1",
        text: "In STEP-1, gastrointestinal adverse events occurred in 74.2% of participants on semaglutide 2.4 mg versus 47.9% on placebo; they were mostly mild to moderate and temporary.",
        sourceIds: ["step-1"],
      },
      {
        id: "safe-2",
        text: "In STEP-1, treatment was stopped because of gastrointestinal events in 4.5% on semaglutide versus 0.8% on placebo.",
        sourceIds: ["step-1"],
      },
      {
        id: "safe-3",
        text: "In STEP-1, 7.0% on semaglutide and 3.1% on placebo stopped treatment because of any adverse event.",
        sourceIds: ["step-1"],
      },
      {
        id: "safe-4",
        text: "In SURMOUNT-1, the most common adverse events with tirzepatide were gastrointestinal, mostly mild to moderate and occurring mainly during dose escalation; adverse events led to stopping in 4.3% (5 mg), 7.1% (10 mg) and 6.2% (15 mg) versus 2.6% on placebo.",
        sourceIds: ["surmount-1"],
      },
      {
        id: "safe-5",
        text: "Boxed warning: semaglutide and tirzepatide caused thyroid C-cell tumours in rodents; it is unknown whether they cause thyroid C-cell tumours, including medullary thyroid carcinoma (MTC), in humans.",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
      {
        id: "safe-6",
        text: "These medicines are contraindicated in people with a personal or family history of medullary thyroid carcinoma (MTC) or with Multiple Endocrine Neoplasia syndrome type 2 (MEN 2).",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
      {
        id: "safe-7",
        text: "Acute pancreatitis has been reported; treatment should be stopped and not restarted if pancreatitis is confirmed, and people should seek care for severe, persistent abdominal pain.",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
      {
        id: "safe-8",
        text: "Gallbladder problems, including gallstones and inflammation of the gallbladder, have been reported, and are associated with rapid weight loss.",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
      {
        id: "safe-9",
        text: "Severe vomiting or diarrhea can cause dehydration, which in some people has led to acute kidney injury.",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
      {
        id: "safe-10",
        text: "Weight loss with these medicines includes loss of lean mass as well as fat mass, as measured in body-composition substudies.",
        sourceIds: ["step-1", "surmount-1"],
      },
      {
        id: "safe-11",
        text: "In SURMOUNT-4, adults who had lost weight on tirzepatide for 36 weeks and were then switched to placebo regained a mean of about 14 percent of body weight over the next 52 weeks, while those who continued tirzepatide lost further weight.",
        sourceIds: ["surmount-4"],
      },
      {
        id: "safe-12",
        text: "In the STEP-1 extension, participants regained about two-thirds of their prior weight loss within a year of stopping semaglutide and lifestyle support.",
        sourceIds: ["step-1-ext"],
      },
      {
        id: "safe-13",
        text: "Used with insulin or a sulfonylurea, these medicines can increase the risk of low blood sugar; and they should be stopped if pregnancy is recognised.",
        sourceIds: ["fda-wegovy", "fda-zepbound"],
      },
    ],
    sources: [STEP1, STEP1_EXT, SURMOUNT1, SURMOUNT4, WEGOVY_LABEL, ZEPBOUND_LABEL],
    keywords: [
      "side effects",
      "nausea",
      "safe",
      "risk",
      "warning",
      "pancreatitis",
      "gallbladder",
      "thyroid",
      "muscle",
      "stop",
      "regain",
      "coming off",
    ],
  },
  {
    id: "future",
    title: "What's next",
    summary:
      "Oral forms, next-generation multi-agonists, open questions on long-term data, access and cost, and a recap.",
    bullets: [
      "Oral options: the Wegovy pill (semaglutide 25 mg) and orforglipron",
      "Next-generation multi-agonists such as retatrutide are still investigational",
      "Open questions: long-term safety, durability and what happens after stopping",
      "Access and cost vary and keep changing",
    ],
    visual: "timeline",
    segments: [
      {
        text: "Pills now exist: an oral form of semaglutide, and a newer non-peptide pill called orforglipron.",
        bullet: 0,
      },
      {
        text: "In a phase 3 trial, orforglipron at its top dose averaged 12.4 percent weight loss over 72 weeks.",
        bullet: 0,
      },
      {
        text: "Researchers are also testing drugs that act on three hormone pathways at once, but those are still investigational.",
        bullet: 1,
      },
      {
        text: "Big questions remain about what happens over many years and after stopping, and access and cost keep changing.",
        bullet: 2,
      },
      {
        text: "To recap, these medicines copy a gut hormone, act on the pancreas, stomach and brain, and bring real benefits alongside real side effects.",
        bullet: 3,
      },
      { text: "Any final questions?", bullet: 3 },
    ],
    facts: [
      {
        id: "future-1",
        text: "An oral once-daily form of semaglutide (25 mg) for chronic weight management was approved by the FDA in December 2025.",
        sourceIds: ["fda-novel-2026"],
      },
      {
        id: "future-2",
        text: "Orforglipron, a small-molecule oral GLP-1 receptor agonist sold as Foundayo, was approved by the FDA in April 2026 for adults with obesity, or overweight with weight-related conditions.",
        sourceIds: ["fda-novel-2026"],
      },
      {
        id: "future-3",
        text: "In the phase 3 ATTAIN-1 trial, orforglipron 36 mg produced a mean weight change of 12.4% at 72 weeks in adults with obesity.",
        sourceIds: ["attain-1"],
      },
      {
        id: "future-4",
        text: "Orforglipron is not a peptide, so unlike oral semaglutide it can be taken without food or water restrictions.",
        sourceIds: ["fda-novel-2026"],
      },
      {
        id: "future-5",
        text: "Retatrutide, which activates the GIP, GLP-1 and glucagon receptors, is investigational and not approved; it is in phase 3 trials.",
        sourceIds: ["retatrutide-trials"],
      },
      {
        id: "future-6",
        text: "Whether people can keep weight off after stopping, and the effects of treatment over many years, are open questions; the longest outcome trial covered here, SELECT, followed participants for a mean of 39.8 months.",
        sourceIds: ["select", "surmount-4"],
      },
      {
        id: "future-7",
        text: "Access, insurance coverage, supply and price of these medicines vary by country and insurer and have changed repeatedly.",
        sourceIds: ["fda-novel-2026"],
      },
      {
        id: "future-8",
        text: "Recap: GLP-1 medicines mimic a gut hormone, act on the pancreas, stomach and brain, are given weekly by injection (with oral options now available), have strong trial evidence, and carry real side effects and warnings.",
        sourceIds: ["drucker-2018", "step-1", "surmount-1", "select"],
      },
    ],
    sources: [FDA_NOVEL, ATTAIN1, RETATRUTIDE, DRUCKER, STEP1, SURMOUNT1, SELECT, SURMOUNT4],
    statusAsOf: "2026-10-26",
    keywords: [
      "pill",
      "oral",
      "what's next",
      "future",
      "orforglipron",
      "retatrutide",
      "cost",
      "access",
      "long-term",
      "recap",
    ],
  },
];

export const slideById = (id: SlideId): Slide => {
  const s = deck.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown slide ${id}`);
  return s;
};
