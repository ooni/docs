// How interference was implemented, as opposed to whether it happened. This is
// deliberately NOT the rule-id vocabulary: a corpus labelled with rule ids can
// only tell you a rule reproduces itself, and rule ids change as rules split.
// Labels use this taxonomy, predictions use rule ids, and evaluation is a
// mapping between them.
//
// Paths are <layer>.<action>.<qualifier>. Every prefix is itself a valid
// label — `tls.mitm` and bare `tls` are both legitimate — so internal nodes
// are selectable, and mean "this layer/action, sub-type not identified". The
// qualifier's meaning depends on the action; it is a taxonomy, not a grammar.
export const MECHANISM_TAXONOMY = "v1";

export interface Mechanism {
  p: string;
  d?: string;
  warn?: string;
}

export const MECHANISMS: Mechanism[] = [
  { p: "dns" },
  { p: "dns.injection" },
  { p: "dns.injection.blockpage", d: "answer is a known blockpage address" },
  { p: "dns.injection.bogon", d: "answer is a bogon or provider-internal address" },
  { p: "dns.injection.other", d: "injected, but neither of the above" },
  { p: "dns.nxdomain", d: "NXDOMAIN for a name that resolves elsewhere" },
  { p: "dns.refused", d: "REFUSED" },
  { p: "dns.timeout", d: "no answer" },

  { p: "tcp" },
  { p: "tcp.reset", d: "RST during connection establishment" },
  { p: "tcp.timeout", d: "SYN unanswered" },
  { p: "tcp.refused", d: "RST in response to SYN" },

  { p: "tls" },
  { p: "tls.reset" },
  { p: "tls.reset.sni", d: "RST after ClientHello, triggered by the server name" },
  { p: "tls.reset.other", d: "RST during handshake, trigger unidentified" },
  { p: "tls.timeout", d: "handshake stalls" },
  { p: "tls.timeout.sni", d: "handshake stalls after the ClientHello, triggered by the server name" },
  { p: "tls.mitm" },
  { p: "tls.mitm.self_signed", d: "presented certificate is self-signed" },
  { p: "tls.mitm.ca_signed", d: "validly signed, but for an unexpected name or issuer" },
  { p: "tls.throttle.sni", d: "throttling keyed on the server name", warn: "unmeasurable today" },

  { p: "http" },
  { p: "http.blockpage", d: "a block page is served" },
  { p: "http.redirect", d: "redirect to a block page" },
  { p: "http.error", d: "status-code refusal (403 and similar)" },
  { p: "http.reset.host", d: "RST after the request line or Host header" },
  { p: "http.timeout", d: "no response" },
  { p: "http.throttle.host", d: "throttling keyed on the Host header", warn: "unmeasurable today" },

  { p: "ip" },
  { p: "ip.unreachable", d: "ICMP unreachable or no route" },
  { p: "ip.prefix_null_route", d: "prefix is null-routed", warn: "needs co-affected evidence" },
];

export const MECH_BY_PATH = new Map(MECHANISMS.map((m) => [m.p, m]));

export const isInternalMechanism = (p: string): boolean =>
  MECHANISMS.some((m) => m.p !== p && m.p.startsWith(p + "."));

export function filterMechanisms(query: string, exclude: string[]): Mechanism[] {
  const q = query.trim().toLowerCase();
  return MECHANISMS.filter(
    (m) =>
      !exclude.includes(m.p) &&
      (m.p.includes(q) || (m.d || "").toLowerCase().includes(q))
  );
}

// Redundant ancestor/descendant pairs auto-collapse to the deeper path, since
// a prefix means "not narrowed further". Returns the next chip list, or null
// if the path was rejected (a narrower path is already present).
export function addMechanism(
  mechs: string[],
  path: string
): { mechs: string[]; rejectedByDeeper?: string } {
  if (mechs.includes(path)) return { mechs };
  const deeper = mechs.find((m) => m.startsWith(path + "."));
  if (deeper) return { mechs, rejectedByDeeper: deeper };
  const next = mechs.filter((m) => !path.startsWith(m + ".")); // replace ancestors
  next.push(path);
  return { mechs: next };
}
