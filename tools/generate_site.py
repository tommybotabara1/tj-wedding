#!/usr/bin/env python3
"""
generate_site.py — Reads TJ MARRIAGE.xlsx from Google Drive and builds docs/index.html.

Usage:
    python tools/generate_site.py

Output:
    docs/index.html
"""

import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(__file__))
from gws import download_workbook

WEDDING_DATE = date(2026, 12, 27)
OUTPUT_PATH  = os.path.join(os.path.dirname(__file__), "..", "docs", "index.html")


# ── Data readers ──────────────────────────────────────────────────────────────

def read_timeline(wb):
    ws = wb["Timeline  Task List"]
    tasks = []
    today = date.today()
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        task, owner, status, deadline = row[0], row[1], row[2], row[3]
        if isinstance(deadline, datetime):
            deadline = deadline.date()
        # Determine effective status
        effective = status or "Not Started"
        if effective not in ("Booked", "Done") and deadline and deadline < today:
            effective = "Overdue"
        tasks.append({
            "task":     task,
            "owner":    owner or "—",
            "status":   effective,
            "deadline": deadline,
        })
    return tasks


def read_budget(wb):
    ws = wb["Budget + Vendor Tracker"]
    # Columns: Category, Vendor, Status, Actual, Balance, Notes, Low, Mid, High
    SKIP = {"Total", "Total + buffer", "Miscellaneous & Contingency (10%)"}
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or row[0] in SKIP:
            continue
        rows.append({
            "category": row[0],
            "low":      row[6],
            "mid":      row[7],
            "high":     row[8],
            "actual":   row[3],
            "balance":  row[4],
            "notes":    row[5] or "",
        })
    return rows


def read_vendors(wb):
    ws = wb["Budget + Vendor Tracker"]
    # Columns: Category, Vendor, Status, Actual, Balance, Notes, Low, Mid, High
    SKIP = {"Total", "Total + buffer", "Miscellaneous & Contingency (10%)"}
    vendors = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or row[0] in SKIP:
            continue
        vendors.append({
            "type":   row[0],
            "name":   row[1] or "",
            "status": row[2] or "Pending",
        })
    return vendors


def read_guests(wb):
    ws = wb["Guest List"]
    total_pax = 0
    confirmed = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        # Skip rows without a numeric guest # in col 0
        if not row[0] or not isinstance(row[0], (int, float)):
            continue
        pax = row[6] if isinstance(row[6], (int, float)) else 1
        total_pax += pax
        status = (row[7] or "").strip().upper()
        if status not in ("TBC", "OPTIONAL", ""):
            confirmed += pax
    return {"total": int(total_pax), "confirmed": int(confirmed)}


def read_schedule(wb):
    ws = wb["Schedule"]
    items = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        # Clean up encoding artifacts (emoji dashes etc)
        time_str = str(row[0]).encode("ascii", "ignore").decode("ascii").strip()
        activity = str(row[1]).encode("ascii", "ignore").decode("ascii").strip() if row[1] else ""
        if time_str and activity:
            items.append({"time": time_str, "activity": activity})
    return items


# ── HTML builders ─────────────────────────────────────────────────────────────

STATUS_BADGE = {
    "Booked":      ("bg-emerald-100 text-emerald-800 border border-emerald-300", "Booked"),
    "Done":        ("bg-emerald-100 text-emerald-800 border border-emerald-300", "Done"),
    "Ongoing":     ("bg-amber-100 text-amber-800 border border-amber-300",       "Ongoing"),
    "Not Started": ("bg-stone-100 text-stone-500 border border-stone-300",       "Not Started"),
    "Overdue":     ("bg-rose-100 text-rose-800 border border-rose-300",          "Overdue"),
}

VENDOR_STATUS_BADGE = {
    "Booked":     ("bg-emerald-100 text-emerald-800 border border-emerald-300", "Booked"),
    "Finalizing": ("bg-blue-100 text-blue-800 border border-blue-300",          "Finalizing"),
    "Looking":    ("bg-amber-100 text-amber-800 border border-amber-300",       "Looking"),
    "Pending":    ("bg-stone-100 text-stone-500 border border-stone-300",       "Pending"),
    "Not Booked": ("bg-stone-100 text-stone-400 border border-stone-300",       "Not Booked"),
}


def fmt_php(val):
    if val is None:
        return "—"
    return f"₱{val:,.0f}"


def fmt_date(d):
    if d is None:
        return "—"
    return d.strftime("%b %d, %Y")


def build_html(tasks, budget, vendors, schedule, guests):
    today          = date.today()
    days_to_go     = (WEDDING_DATE - today).days
    booked_count   = sum(1 for v in vendors if v["status"] == "Booked")
    total_vendors  = len(vendors)
    total_actual   = sum(r["actual"] for r in budget if r["actual"])
    overdue_count  = sum(1 for t in tasks if t["status"] == "Overdue")

    # Budget chart data
    chart_labels  = [r["category"][:22] + "…" if len(r["category"]) > 22 else r["category"] for r in budget]
    chart_mid     = [r["mid"] or 0 for r in budget]
    chart_actual  = [r["actual"] or 0 for r in budget]

    chart_labels_js  = str(chart_labels).replace("'", "\\'").replace('"', "'")
    chart_mid_js     = str(chart_mid)
    chart_actual_js  = str(chart_actual)

    # Timeline rows
    timeline_rows = ""
    for t in tasks:
        cls, label = STATUS_BADGE.get(t["status"], STATUS_BADGE["Not Started"])
        deadline_str = fmt_date(t["deadline"])
        row_cls = "bg-rose-50" if t["status"] == "Overdue" else "hover:bg-stone-50"
        timeline_rows += f"""
        <tr class="{row_cls} transition-colors">
          <td class="px-4 py-3 text-sm text-stone-800">{t['task']}</td>
          <td class="px-4 py-3 text-sm text-stone-500 text-center">{t['owner']}</td>
          <td class="px-4 py-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-medium {cls}">{label}</span>
          </td>
          <td class="px-4 py-3 text-sm text-stone-500 text-center">{deadline_str}</td>
        </tr>"""

    # Budget rows
    budget_rows = ""
    for r in budget:
        actual_cls  = "text-emerald-700 font-semibold" if r["actual"] else "text-stone-300"
        balance_cls = "text-rose-600 font-semibold" if (r["balance"] or 0) > 0 else "text-stone-300"
        vendor_display = f'<span class="text-stone-400 text-xs">{r.get("vendor","")}</span>' if r.get("vendor") else ""
        budget_rows += f"""
        <tr class="hover:bg-stone-50 transition-colors">
          <td class="px-4 py-3 text-sm text-stone-800">{r['category']}</td>
          <td class="px-4 py-3 text-sm text-stone-500 text-right">{fmt_php(r['low'])}</td>
          <td class="px-4 py-3 text-sm text-stone-600 text-right font-medium">{fmt_php(r['mid'])}</td>
          <td class="px-4 py-3 text-sm text-stone-500 text-right">{fmt_php(r['high'])}</td>
          <td class="px-4 py-3 text-sm text-right {actual_cls}">{fmt_php(r['actual'])}</td>
          <td class="px-4 py-3 text-sm text-right {balance_cls}">{fmt_php(r['balance'])}</td>
        </tr>"""

    # Vendor cards
    vendor_cards = ""
    for v in vendors:
        v_cls, v_label = VENDOR_STATUS_BADGE.get(v["status"], VENDOR_STATUS_BADGE["Not Booked"])
        name_display = v["name"] if v["name"] else '<span class="text-stone-300 italic">TBD</span>'
        card_border  = "border-emerald-200 bg-emerald-50/30" if v["status"] == "Booked" else "border-stone-200 bg-white"
        vendor_cards += f"""
        <div class="rounded-xl border {card_border} p-4 flex flex-col gap-2 hover:shadow-md transition-shadow">
          <div class="text-xs font-semibold text-stone-400 uppercase tracking-widest">{v['type']}</div>
          <div class="text-sm font-medium text-stone-800">{name_display}</div>
          <span class="self-start px-2 py-0.5 rounded-full text-xs font-medium {v_cls}">{v_label}</span>
        </div>"""

    # Schedule items
    schedule_items = ""
    for i, item in enumerate(schedule):
        dot_cls = "bg-[#8B1A35]" if i == 0 else "bg-stone-300"
        schedule_items += f"""
        <div class="flex gap-4 items-start">
          <div class="flex flex-col items-center">
            <div class="w-3 h-3 rounded-full {dot_cls} mt-1 flex-shrink-0"></div>
            {'<div class="w-px flex-1 bg-stone-200 mt-1"></div>' if i < len(schedule)-1 else ''}
          </div>
          <div class="pb-6">
            <div class="text-xs font-semibold text-[#8B1A35] uppercase tracking-widest mb-0.5">{item['time']}</div>
            <div class="text-sm text-stone-700">{item['activity']}</div>
          </div>
        </div>"""

    # Overdue alert
    overdue_banner = ""
    if overdue_count:
        overdue_banner = f"""
    <div class="max-w-6xl mx-auto px-6 mb-4">
      <div class="bg-rose-50 border border-rose-200 rounded-xl px-5 py-3 flex items-center gap-3">
        <span class="text-rose-600 text-lg">&#9888;</span>
        <span class="text-rose-700 text-sm font-medium">{overdue_count} task{"s" if overdue_count != 1 else ""} overdue — review the timeline below.</span>
      </div>
    </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tommy &amp; Jeyan — Wedding Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {{
      --burgundy: #8B1A35;
      --gold:     #B5924C;
      --cream:    #FAF7F2;
    }}
    body {{ background-color: var(--cream); font-family: 'Inter', sans-serif; }}
    .serif {{ font-family: 'Cormorant Garamond', Georgia, serif; }}
    .section-card {{ background: white; border: 1px solid #E8E0D5; border-radius: 16px; }}
    @keyframes fadeUp {{
      from {{ opacity: 0; transform: translateY(16px); }}
      to   {{ opacity: 1; transform: translateY(0); }}
    }}
    .animate-fadeup {{ animation: fadeUp 0.6s ease both; }}
    .delay-1 {{ animation-delay: 0.1s; }}
    .delay-2 {{ animation-delay: 0.2s; }}
    .delay-3 {{ animation-delay: 0.3s; }}
    .delay-4 {{ animation-delay: 0.4s; }}
    .delay-5 {{ animation-delay: 0.5s; }}
    .delay-6 {{ animation-delay: 0.6s; }}
    .stat-pill {{
      background: white;
      border: 1px solid #E8E0D5;
      border-radius: 12px;
      padding: 16px 24px;
    }}
    .divider-ornament {{
      display: flex; align-items: center; gap: 12px; margin: 0 auto;
    }}
    .divider-ornament::before, .divider-ornament::after {{
      content: ''; flex: 1; height: 1px; background: #D4C5B0;
    }}
  </style>
</head>
<body class="min-h-screen">

  <!-- ── HERO HEADER ─────────────────────────────────────────────────────── -->
  <header class="relative overflow-hidden" style="background: linear-gradient(160deg, #2D0A16 0%, #5A1525 50%, #8B1A35 100%);">
    <div class="absolute inset-0 opacity-10" style="background-image: repeating-linear-gradient(45deg, transparent, transparent 30px, rgba(181,146,76,0.3) 30px, rgba(181,146,76,0.3) 31px);"></div>
    <div class="relative max-w-6xl mx-auto px-6 py-16 text-center">
      <p class="text-[#B5924C] text-xs tracking-[0.4em] uppercase mb-4 animate-fadeup">The Wedding of</p>
      <h1 class="serif text-6xl md:text-7xl text-white font-light italic mb-2 animate-fadeup delay-1">Tommy &amp; Jeyan</h1>
      <div class="divider-ornament w-48 mx-auto my-5 animate-fadeup delay-2">
        <span class="text-[#B5924C] text-lg">&#10022;</span>
      </div>
      <p class="serif text-2xl text-[#E8D5B5] font-light animate-fadeup delay-2">December 27, 2026 &nbsp;&bull;&nbsp; St. Therese Parish, BGC</p>
      <div id="countdown" class="mt-8 flex justify-center gap-6 animate-fadeup delay-3">
        <div class="text-center">
          <div id="cnt-days" class="serif text-5xl text-white font-light">—</div>
          <div class="text-[#B5924C] text-xs tracking-widest uppercase mt-1">Days</div>
        </div>
        <div class="serif text-4xl text-[#B5924C] font-light self-start mt-1">:</div>
        <div class="text-center">
          <div id="cnt-hours" class="serif text-5xl text-white font-light">—</div>
          <div class="text-[#B5924C] text-xs tracking-widest uppercase mt-1">Hours</div>
        </div>
        <div class="serif text-4xl text-[#B5924C] font-light self-start mt-1">:</div>
        <div class="text-center">
          <div id="cnt-mins" class="serif text-5xl text-white font-light">—</div>
          <div class="text-[#B5924C] text-xs tracking-widest uppercase mt-1">Minutes</div>
        </div>
      </div>
      <p class="text-stone-400 text-xs mt-8 animate-fadeup delay-4">Last updated: {datetime.now().strftime("%B %d, %Y at %I:%M %p")}</p>
    </div>
  </header>

  <!-- ── QUICK STATS ─────────────────────────────────────────────────────── -->
  <section class="max-w-6xl mx-auto px-6 py-8 animate-fadeup delay-2">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">{days_to_go}</div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Days to Go</div>
      </div>
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">{booked_count}<span class="text-stone-300 text-xl">/{total_vendors}</span></div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Vendors Booked</div>
      </div>
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">₱{total_actual:,.0f}</div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Budget Spent</div>
      </div>
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">{guests['total']}</div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Guests (est.)</div>
      </div>
    </div>
  </section>

  {overdue_banner}

  <main class="max-w-6xl mx-auto px-6 pb-16 space-y-8">

    <!-- ── TIMELINE & TASKS ───────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-3">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Planning Timeline</h2>
        <p class="text-stone-400 text-sm mt-0.5">{len(tasks)} milestones &mdash; {sum(1 for t in tasks if t['status'] in ('Booked','Done'))} completed</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-stone-50 border-b border-stone-100">
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Task</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Owner</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Status</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Deadline</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-50">
            {timeline_rows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── BUDGET ─────────────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-4">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Budget Overview</h2>
        <p class="text-stone-400 text-sm mt-0.5">Total committed: <span class="text-emerald-700 font-semibold">₱{total_actual:,.0f}</span></p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-stone-50 border-b border-stone-100">
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider w-2/5">Category</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Low</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Mid</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">High</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Actual</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Balance</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-50">
            {budget_rows}
          </tbody>
          <tfoot>
            <tr class="bg-stone-50 border-t border-stone-200">
              <td class="px-4 py-3 text-sm font-semibold text-stone-700" colspan="4">Total Actual Spent</td>
              <td class="px-4 py-3 text-right text-sm font-bold text-emerald-700">₱{total_actual:,.0f}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="px-6 py-5 border-t border-stone-100">
        <h3 class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-4">Mid-Range vs Actual</h3>
        <div class="h-64">
          <canvas id="budgetChart"></canvas>
        </div>
      </div>
    </section>

    <!-- ── VENDOR TRACKER ─────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-5">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Vendor Tracker</h2>
        <p class="text-stone-400 text-sm mt-0.5">{booked_count} of {total_vendors} vendors confirmed</p>
      </div>
      <div class="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {vendor_cards}
      </div>
    </section>

    <!-- ── DAY-OF SCHEDULE ────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-6">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Day-of Schedule</h2>
        <p class="text-stone-400 text-sm mt-0.5">December 27, 2026</p>
      </div>
      <div class="p-6">
        {schedule_items}
      </div>
    </section>

  </main>

  <footer class="text-center py-8 text-stone-300 text-xs tracking-wider">
    <span class="serif italic text-stone-400">Tommy &amp; Jeyan &bull; December 27, 2026</span>
  </footer>

  <script>
    // Countdown timer
    function updateCountdown() {{
      const wedding = new Date('2026-12-27T15:00:00+08:00');
      const now     = new Date();
      const diff    = wedding - now;
      if (diff <= 0) {{
        document.getElementById('cnt-days').textContent  = '0';
        document.getElementById('cnt-hours').textContent = '0';
        document.getElementById('cnt-mins').textContent  = '0';
        return;
      }}
      const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      document.getElementById('cnt-days').textContent  = days;
      document.getElementById('cnt-hours').textContent = String(hours).padStart(2, '0');
      document.getElementById('cnt-mins').textContent  = String(mins).padStart(2, '0');
    }}
    updateCountdown();
    setInterval(updateCountdown, 30000);

    // Budget chart
    const ctx = document.getElementById('budgetChart').getContext('2d');
    new Chart(ctx, {{
      type: 'bar',
      data: {{
        labels: {chart_labels_js},
        datasets: [
          {{
            label: 'Mid Range',
            data: {chart_mid_js},
            backgroundColor: 'rgba(181,146,76,0.2)',
            borderColor: 'rgba(181,146,76,0.6)',
            borderWidth: 1,
            borderRadius: 4,
          }},
          {{
            label: 'Actual',
            data: {chart_actual_js},
            backgroundColor: 'rgba(16,185,129,0.3)',
            borderColor: 'rgba(16,185,129,0.7)',
            borderWidth: 1,
            borderRadius: 4,
          }}
        ]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {{
          legend: {{
            labels: {{ font: {{ family: 'Inter', size: 11 }}, color: '#78716c' }}
          }}
        }},
        scales: {{
          x: {{
            ticks: {{
              font: {{ family: 'Inter', size: 9 }},
              color: '#a8a29e',
              maxRotation: 45,
            }},
            grid: {{ color: '#f5f0eb' }}
          }},
          y: {{
            ticks: {{
              font: {{ family: 'Inter', size: 10 }},
              color: '#a8a29e',
              callback: v => '₱' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)
            }},
            grid: {{ color: '#f5f0eb' }}
          }}
        }}
      }}
    }});
  </script>
</body>
</html>
"""
    return html


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Downloading workbook from Drive...")
    wb = download_workbook()

    print("Reading sheets...")
    tasks    = read_timeline(wb)
    budget   = read_budget(wb)
    vendors  = read_vendors(wb)
    schedule = read_schedule(wb)
    guests   = read_guests(wb)

    print(f"  Timeline : {len(tasks)} tasks")
    print(f"  Budget   : {len(budget)} categories")
    print(f"  Vendors  : {len(vendors)} vendors")
    print(f"  Schedule : {len(schedule)} items")
    print(f"  Guests   : {guests['total']} total pax")

    print("Generating HTML...")
    html = build_html(tasks, budget, vendors, schedule, guests)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Done -> {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()
