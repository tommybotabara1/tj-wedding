#!/usr/bin/env python3
"""
generate_site.py — Reads TJ MARRIAGE.xlsx from Google Drive and builds docs/index.html.

Usage:
    python tools/generate_site.py

Output:
    docs/index.html
"""

import json
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
        # Skip stray URL rows (e.g. ChatGPT share links)
        if str(row[0]).startswith("http"):
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
            "vendor":   row[1] or "",
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
    # Columns: #, Name, Side, Group, Role, +1?, Pax, Status, Notes, Table#
    rows = []
    total_pax = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or not isinstance(row[0], (int, float)):
            continue
        pax   = int(row[6]) if isinstance(row[6], (int, float)) else 1
        table = int(row[9]) if isinstance(row[9], (int, float)) else None
        rows.append({
            "num":    int(row[0]),
            "name":   str(row[1]).strip() if row[1] else "",
            "side":   str(row[2]).strip() if row[2] else "",
            "group":  str(row[3]).strip() if row[3] else "",
            "role":   str(row[4]).strip() if row[4] else "",
            "plus1":  str(row[5]).strip() if row[5] else "No",
            "pax":    pax,
            "status": str(row[7]).strip() if row[7] else "TBC",
            "notes":  str(row[8]).strip() if row[8] else "",
            "table":  table,
        })
        total_pax += pax
    return {"total": int(total_pax), "rows": rows}


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


ROLE_BADGE = {
    "VIP / Principal Sponsor (Ninong/Ninang)": ("bg-amber-100 text-amber-800 border border-amber-200", "Principal Sponsor"),
    "MOH":                        ("bg-rose-100 text-rose-700 border border-rose-200",    "MOH"),
    "Best Man":                   ("bg-rose-100 text-rose-700 border border-rose-200",    "Best Man"),
    "Entourage - Bridesmaid":     ("bg-pink-100 text-pink-700 border border-pink-200",    "Bridesmaid"),
    "Entourage - Groomsmen":      ("bg-blue-100 text-blue-700 border border-blue-200",    "Groomsman"),
    "Candle":                     ("bg-stone-100 text-stone-500 border border-stone-200", "Candle"),
    "Cord":                       ("bg-stone-100 text-stone-500 border border-stone-200", "Cord"),
    "Veil":                       ("bg-stone-100 text-stone-500 border border-stone-200", "Veil"),
    "Ring":                       ("bg-stone-100 text-stone-500 border border-stone-200", "Ring"),
    "Flower Girl":                ("bg-purple-100 text-purple-700 border border-purple-200", "Flower Girl"),
}

def build_html(tasks, budget, vendors, schedule, guests):
    today          = date.today()
    days_to_go     = (WEDDING_DATE - today).days
    booked_count   = sum(1 for v in vendors if v["status"] == "Booked")
    total_vendors  = len(vendors)
    total_actual   = sum(r["actual"] for r in budget if r["actual"])
    overdue_count  = sum(1 for t in tasks if t["status"] == "Overdue")

    # Guest list rows + filter options
    guest_groups = sorted(set(g["group"] for g in guests["rows"] if g["group"]))
    group_options = "".join(f'<option value="{grp}">{grp}</option>' for grp in guest_groups)

    guest_rows = ""
    for g in guests["rows"]:
        side_cls   = "bg-rose-50 text-rose-700" if g["side"] == "Jeyan" else "bg-blue-50 text-blue-700"
        role_info  = ROLE_BADGE.get(g["role"])
        role_badge = f'<span class="px-1.5 py-0.5 rounded text-xs font-medium {role_info[0]}">{role_info[1]}</span>' if role_info else ""
        table_str  = f"Table {g['table']}" if g["table"] else '<span class="text-stone-300">—</span>'
        guest_rows += f"""
        <tr class="hover:bg-stone-50 transition-colors" data-side="{g['side']}" data-group="{g['group']}">
          <td class="px-3 py-2 text-sm font-medium text-stone-800">{g['name']}</td>
          <td class="px-3 py-2 text-xs text-stone-500">{g['group']}</td>
          <td class="px-3 py-2 text-xs">{role_badge}</td>
          <td class="px-3 py-2 text-center"><span class="text-xs font-semibold px-1.5 py-0.5 rounded {side_cls}">{g['side']}</span></td>
          <td class="px-3 py-2 text-xs text-center text-stone-500">{g['pax']}{'<span class="text-emerald-600 font-bold"> +1</span>' if g["plus1"] == "Yes" else ''}</td>
          <td class="px-3 py-2 text-xs text-stone-500 text-center">{table_str}</td>
        </tr>"""

    # Budget chart data
    chart_labels = [r["category"][:22] + "…" if len(r["category"]) > 22 else r["category"] for r in budget]
    chart_actual = [r["actual"] or 0 for r in budget]

    chart_labels_js = json.dumps(chart_labels)
    chart_actual_js = json.dumps(chart_actual)

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
        vendor_display = r["vendor"] if r["vendor"] else '<span class="italic text-stone-300">TBD</span>'
        budget_rows += f"""
        <tr class="hover:bg-stone-50 transition-colors">
          <td class="px-4 py-3 text-sm text-stone-800">{r['category']}</td>
          <td class="px-4 py-3 text-sm text-stone-500">{vendor_display}</td>
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
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Category</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Vendor</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Actual</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Balance</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-50">
            {budget_rows}
          </tbody>
          <tfoot>
            <tr class="bg-stone-50 border-t border-stone-200">
              <td class="px-4 py-3 text-sm font-semibold text-stone-700" colspan="2">Total Actual Spent</td>
              <td class="px-4 py-3 text-right text-sm font-bold text-emerald-700">₱{total_actual:,.0f}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="px-6 py-5 border-t border-stone-100">
        <h3 class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-4">Actual Spend by Category</h3>
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

    <!-- ── GUEST LIST ──────────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-6">
      <div class="px-6 py-5 border-b border-stone-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="serif text-2xl font-light text-stone-800">Guest List</h2>
          <p class="text-stone-400 text-sm mt-0.5">
            <span id="guest-count">{len(guests['rows'])}</span> of {len(guests['rows'])} guests &mdash; {guests['total']} pax
          </p>
        </div>
        <a href="reception.html" class="text-xs font-medium px-4 py-2 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 transition-colors">
          View Seating Chart →
        </a>
      </div>
      <div class="px-4 py-3 border-b border-stone-100 bg-stone-50 flex flex-wrap gap-2">
        <input type="text" id="guest-search" placeholder="Search by name…"
          class="flex-1 min-w-48 px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white"
          oninput="applyGuestFilters()" />
        <select id="guest-side" onchange="applyGuestFilters()"
          class="px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white text-stone-600">
          <option value="">All sides</option>
          <option value="Tommy">Tommy</option>
          <option value="Jeyan">Jeyan</option>
        </select>
        <select id="guest-group" onchange="applyGuestFilters()"
          class="px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white text-stone-600">
          <option value="">All groups</option>
          {group_options}
        </select>
        <button onclick="clearGuestFilters()"
          class="px-3 py-1.5 text-xs text-stone-400 border border-stone-200 rounded-lg hover:bg-stone-100 bg-white">
          Clear
        </button>
      </div>
      <div class="overflow-x-auto">
        <div style="max-height:520px; overflow-y:auto;">
          <table class="w-full">
            <thead class="sticky top-0 z-10">
              <tr class="bg-stone-50 border-b border-stone-100">
                <th class="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Name</th>
                <th class="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Group</th>
                <th class="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Role</th>
                <th class="px-3 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Side</th>
                <th class="px-3 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Pax</th>
                <th class="px-3 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Table</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-50" id="guest-tbody">
              {guest_rows}
            </tbody>
          </table>
        </div>
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

    // Guest search + filter
    function applyGuestFilters() {{
      const q     = document.getElementById('guest-search').value.toLowerCase();
      const side  = document.getElementById('guest-side').value;
      const group = document.getElementById('guest-group').value;
      const rows  = document.querySelectorAll('#guest-tbody tr');
      let visible = 0;
      rows.forEach(r => {{
        const matchQ = !q     || r.textContent.toLowerCase().includes(q);
        const matchS = !side  || r.dataset.side  === side;
        const matchG = !group || r.dataset.group === group;
        const show   = matchQ && matchS && matchG;
        r.style.display = show ? '' : 'none';
        if (show) visible++;
      }});
      document.getElementById('guest-count').textContent = visible;
    }}
    function clearGuestFilters() {{
      document.getElementById('guest-search').value = '';
      document.getElementById('guest-side').value   = '';
      document.getElementById('guest-group').value  = '';
      applyGuestFilters();
    }}

    // Budget chart
    const ctx = document.getElementById('budgetChart').getContext('2d');
    new Chart(ctx, {{
      type: 'bar',
      data: {{
        labels: {chart_labels_js},
        datasets: [
          {{
            label: 'Actual Spend',
            data: {chart_actual_js},
            backgroundColor: 'rgba(139,26,53,0.25)',
            borderColor: 'rgba(139,26,53,0.7)',
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


# ── Reception / Seating Chart ─────────────────────────────────────────────────

TABLE_META = {
    1:  ("VIP", "#B5924C"),   2:  ("VIP", "#B5924C"),   3:  ("VIP", "#B5924C"),
    4:  ("Jeyan Family", "#D4A5A0"), 5: ("Jeyan Family", "#D4A5A0"), 6: ("Jeyan Family", "#D4A5A0"),
    7:  ("Tommy Family", "#B8837A"), 8: ("Tommy Family", "#B8837A"), 9: ("Tommy Family", "#B8837A"),
    10: ("Jeyan Friends", "#7A9E7E"), 11: ("Jeyan Friends", "#7A9E7E"),
    12: ("Jeyan Friends", "#7A9E7E"), 13: ("Jeyan Friends", "#7A9E7E"),
    14: ("Tommy Friends", "#8B1A35"), 15: ("Tommy Friends", "#8B1A35"), 16: ("Tommy Friends", "#8B1A35"),
}

# Talisay floor plan: ~9.8m wide × 33m long (300 sqm)
# SVG viewBox: 320 × 960. Scale: ~25px/m
# Kitchen top-left, entrance at bottom, stairs notch bottom-right.
# Left table column x=95, right column x=225. Row spacing 78px.
TABLE_POS = {
    1:  (95,  290),   # Row 1 left  — Sponsors
    2:  (225, 290),   # Row 1 right — Sponsors
    3:  (95,  368),   # Row 2 left  — Sponsors
    4:  (225, 368),
    5:  (95,  446),
    6:  (225, 446),
    7:  (95,  524),
    8:  (225, 524),
    9:  (95,  602),
    10: (225, 602),
    11: (95,  680),
    12: (225, 680),
    13: (95,  758),
    14: (225, 758),
    15: (95,  836),
    16: (225, 836),
}

def make_floor_plan_svg(option, by_table):
    """Return an SVG string for the Talisay floor plan.
    option='a' → all round tables; option='b' → tables 1-3 as sponsor rectangles.
    """
    SPONSOR_TABLES = {1, 2, 3}

    table_svgs = ""
    for tnum, (cx, cy) in TABLE_POS.items():
        _, color = TABLE_META.get(tnum, ("Guest", "#A0A0A0"))
        members   = by_table.get(tnum, [])
        total_pax = sum(g["pax"] for g in members)
        warn      = " ⚠" if total_pax > 10 else ""

        if option == "b" and tnum in SPONSOR_TABLES:
            rw, rh   = 110, 38
            rx_pos   = cx - rw // 2
            ry_pos   = cy - rh // 2
            table_svgs += f'\n    <rect x="{rx_pos}" y="{ry_pos}" width="{rw}" height="{rh}" rx="4" fill="{color}" fill-opacity="0.25" stroke="{color}" stroke-width="1.5"/>'
            table_svgs += f'\n    <text x="{cx}" y="{cy - 5}" text-anchor="middle" font-size="10" font-weight="bold" fill="{color}">{tnum} · {int(total_pax)}pax{warn}</text>'
            table_svgs += f'\n    <text x="{cx}" y="{cy + 10}" text-anchor="middle" font-size="8" fill="{color}" font-style="italic">Sponsors</text>'
        else:
            table_svgs += f'\n    <circle cx="{cx}" cy="{cy}" r="28" fill="{color}" fill-opacity="0.25" stroke="{color}" stroke-width="1.5"/>'
            table_svgs += f'\n    <text x="{cx}" y="{cy - 5}" text-anchor="middle" font-size="11" font-weight="bold" fill="{color}">{tnum}</text>'
            table_svgs += f'\n    <text x="{cx}" y="{cy + 9}" text-anchor="middle" font-size="9" fill="#5A4040">{int(total_pax)}pax{warn}</text>'

    return f"""<svg viewBox="0 0 320 960" width="320" height="960" xmlns="http://www.w3.org/2000/svg" class="block">
  <!-- Hall outline: slight trapezoid with stair notch bottom-right -->
  <polygon points="30,30 290,30 290,920 250,960 30,960" fill="#F9F6F2" stroke="#D4C5B0" stroke-width="2"/>

  <!-- Kitchen — top-left corner -->
  <rect x="30" y="30" width="90" height="65" rx="3" fill="#f5e6d3" stroke="#C4A882" stroke-width="1.5"/>
  <text x="75" y="57" text-anchor="middle" font-size="8" fill="#8B6340" font-weight="600" letter-spacing="0.5">KITCHEN</text>
  <text x="75" y="70" text-anchor="middle" font-size="7" fill="#A88060">3.6m &#215; 2.6m</text>

  <!-- Catering area — right of kitchen -->
  <rect x="130" y="30" width="100" height="40" rx="3" fill="none" stroke="#C4A882" stroke-width="1.5" stroke-dasharray="4,3"/>
  <text x="180" y="46" text-anchor="middle" font-size="8" fill="#8B6340" font-weight="600" letter-spacing="0.5">CATERING</text>
  <text x="180" y="58" text-anchor="middle" font-size="7" fill="#A88060">area</text>

  <!-- Stage — centered near top -->
  <rect x="80" y="115" width="160" height="38" rx="6" fill="#8B1A35" fill-opacity="0.15" stroke="#8B1A35" stroke-width="1.5"/>
  <text x="160" y="131" text-anchor="middle" font-size="9" font-weight="bold" fill="#8B1A35">Tommy &amp; Jeyan</text>
  <text x="160" y="145" text-anchor="middle" font-size="8" fill="#8B1A35">Stage &middot; Couple&#39;s Table</text>

  <!-- Dance floor — below stage -->
  <rect x="70" y="165" width="180" height="70" rx="6" fill="#fdf6f0" stroke="#D4C5B0" stroke-width="1.5" stroke-dasharray="4,3"/>
  <text x="160" y="196" text-anchor="middle" font-size="10" fill="#B0A090" letter-spacing="1.5">DANCE FLOOR</text>
  <text x="160" y="212" text-anchor="middle" font-size="8" fill="#C8B8A0">7.2m &#215; 2.8m</text>

  <!-- DJ Booth — right side near dance floor -->
  <rect x="262" y="200" width="26" height="26" rx="3" fill="#E8D5B5" stroke="#B5924C" stroke-width="1.5"/>
  <text x="275" y="210" text-anchor="middle" font-size="6" fill="#8B6340" font-weight="600">DJ</text>
  <text x="275" y="220" text-anchor="middle" font-size="6" fill="#8B6340">booth</text>

  <!-- Utility rooms — right wall mid-section -->
  <rect x="263" y="500" width="25" height="50" rx="2" fill="#EEE8E0" stroke="#C4B89A" stroke-width="1"/>
  <text x="275" y="521" text-anchor="middle" font-size="6" fill="#8B7355">UTIL</text>
  <text x="275" y="531" text-anchor="middle" font-size="6" fill="#8B7355">1</text>
  <rect x="263" y="558" width="25" height="50" rx="2" fill="#EEE8E0" stroke="#C4B89A" stroke-width="1"/>
  <text x="275" y="579" text-anchor="middle" font-size="6" fill="#8B7355">UTIL</text>
  <text x="275" y="589" text-anchor="middle" font-size="6" fill="#8B7355">2</text>

  <!-- Aisle line -->
  <line x1="160" y1="248" x2="160" y2="865" stroke="#E8E0D5" stroke-width="1" stroke-dasharray="4,4"/>

  <!-- Guest tables -->
  {table_svgs}

  <!-- Mobile bar — bottom-left near entrance -->
  <rect x="30" y="895" width="60" height="28" rx="4" fill="#E8D5B5" stroke="#B5924C" stroke-width="1.5"/>
  <text x="60" y="908" text-anchor="middle" font-size="7" fill="#8B6340" font-weight="600">MOBILE</text>
  <text x="60" y="918" text-anchor="middle" font-size="7" fill="#8B6340">BAR</text>

  <!-- Entrance doors — bottom-center -->
  <rect x="100" y="910" width="55" height="24" rx="4" fill="#E8E0D5"/>
  <rect x="170" y="910" width="55" height="24" rx="4" fill="#E8E0D5"/>
  <text x="127" y="926" text-anchor="middle" font-size="7" fill="#8B7355">DOOR</text>
  <text x="197" y="926" text-anchor="middle" font-size="7" fill="#8B7355">DOOR</text>
  <text x="160" y="950" text-anchor="middle" font-size="8" fill="#B0A090" letter-spacing="1">ENTRANCE</text>

  <!-- Stairs notch — bottom-right -->
  <polygon points="250,960 290,920 290,960" fill="#E8E0D5" stroke="#C4B89A" stroke-width="1"/>
  <text x="272" y="948" text-anchor="middle" font-size="6" fill="#8B7355">STAIRS</text>

  <!-- Dimension label -->
  <text x="160" y="25" text-anchor="middle" font-size="7" fill="#B0A090">9.8 m</text>
</svg>"""


def build_reception_html(guests):
    # Group guests by table
    by_table = {}
    unassigned = []
    for g in guests["rows"]:
        if g["table"]:
            by_table.setdefault(g["table"], []).append(g)
        else:
            unassigned.append(g)

    # Build SVG floor plans for both layout options
    svg_a = make_floor_plan_svg("a", by_table)
    svg_b = make_floor_plan_svg("b", by_table)

    # Table cards HTML
    table_cards = ""
    for tnum in sorted(by_table.keys()):
        members  = by_table[tnum]
        cat, color = TABLE_META.get(tnum, ("Guest", "#A0A0A0"))
        total_pax  = sum(g["pax"] for g in members)
        warn_html  = '<span class="ml-1 text-amber-600 font-bold" title="Over 10 pax">⚠</span>' if total_pax > 10 else ""
        names_html = ""
        for g in members:
            role_info = ROLE_BADGE.get(g["role"])
            role_html = f'<span class="ml-1 px-1 py-0.5 rounded text-xs font-medium {role_info[0]}">{role_info[1]}</span>' if role_info else ""
            plus_html = ' <span class="text-xs text-emerald-600">+1</span>' if g["plus1"] == "Yes" else ""
            names_html += f'<li class="flex items-center gap-1 py-0.5 border-b border-stone-50 last:border-0">{g["name"]}{plus_html}{role_html}</li>'
        table_cards += f"""
        <div class="rounded-xl border border-stone-200 overflow-hidden hover:shadow-md transition-shadow">
          <div class="px-4 py-3 flex items-center justify-between" style="background: {color}22; border-bottom: 1px solid {color}44;">
            <div>
              <span class="text-xs font-semibold tracking-widest uppercase text-stone-400">Table {tnum}</span>
              <span class="ml-2 text-xs" style="color:{color};">{cat}</span>
            </div>
            <span class="text-sm font-semibold text-stone-600">{int(total_pax)} pax{warn_html}</span>
          </div>
          <ul class="px-4 py-2 text-sm text-stone-700">{names_html}</ul>
        </div>"""

    # Unassigned section
    unassigned_html = ""
    if unassigned:
        items = "".join(f'<li class="py-0.5 border-b border-stone-50 last:border-0 text-sm text-stone-600">{g["name"]} <span class="text-xs text-stone-400">({g["group"]})</span></li>' for g in unassigned)
        unassigned_html = f"""
        <div class="section-card overflow-hidden mt-8">
          <div class="px-6 py-4 border-b border-stone-100 bg-amber-50">
            <h3 class="serif text-xl font-light text-amber-800">Unassigned ({len(unassigned)} guests)</h3>
            <p class="text-amber-600 text-xs mt-0.5">These guests have not yet been assigned to a table.</p>
          </div>
          <ul class="px-6 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6">{items}</ul>
        </div>"""

    from datetime import datetime
    now_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tommy &amp; Jeyan — Reception Seating</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {{ --burgundy: #8B1A35; --gold: #B5924C; --cream: #FAF7F2; }}
    body {{ background-color: var(--cream); font-family: 'Inter', sans-serif; }}
    .serif {{ font-family: 'Cormorant Garamond', Georgia, serif; }}
    .section-card {{ background: white; border: 1px solid #E8E0D5; border-radius: 16px; }}
  </style>
</head>
<body class="min-h-screen">

  <header style="background: linear-gradient(160deg, #2D0A16 0%, #5A1525 50%, #8B1A35 100%);">
    <div class="max-w-7xl mx-auto px-6 py-10 flex items-center justify-between flex-wrap gap-4">
      <div>
        <p class="text-[#B5924C] text-xs tracking-[0.4em] uppercase mb-1">Reception · Talisay Events Hall</p>
        <h1 class="serif text-4xl md:text-5xl text-white font-light italic">Seating Chart</h1>
        <p class="text-stone-400 text-xs mt-2">Tommy &amp; Jeyan &bull; December 27, 2026 &bull; Updated {now_str}</p>
      </div>
      <a href="index.html" class="text-xs text-[#B5924C] border border-[#B5924C] px-4 py-2 rounded-full hover:bg-[#B5924C] hover:text-white transition-colors">← Dashboard</a>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-10">

    <!-- Venue info + legend -->
    <div class="flex flex-wrap gap-4 mb-8 items-start">
      <div class="section-card px-6 py-4 flex-1 min-w-60">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Venue</p>
        <p class="serif text-xl font-light text-stone-800">Gallio Events Hall — Talisay</p>
        <p class="text-stone-400 text-sm">±300 sqm · 9.8m × 33m · {guests['total']} est. pax</p>
      </div>
      <div class="section-card px-6 py-4">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">Legend</p>
        <div class="flex flex-wrap gap-3 text-xs">
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#B5924C"></span>VIP / Sponsors</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#D4A5A0"></span>Jeyan's Family</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#B8837A"></span>Tommy's Family</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#7A9E7E"></span>Jeyan's Friends</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#8B1A35"></span>Tommy's Friends</span>
        </div>
      </div>
    </div>

    <div class="flex flex-col lg:flex-row gap-8">

      <!-- Floor plan SVG with layout options -->
      <div class="section-card p-6 flex-shrink-0">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3">Floor Plan — Talisay (300 sqm)</p>
        <div class="flex gap-2 mb-4">
          <button id="btn-a" onclick="showOption('a')"
            class="px-3 py-1.5 text-xs font-medium rounded-full border border-[#8B1A35] bg-[#8B1A35] text-white transition-colors">
            Option A &middot; All Round
          </button>
          <button id="btn-b" onclick="showOption('b')"
            class="px-3 py-1.5 text-xs font-medium rounded-full border border-stone-300 text-stone-500 hover:bg-stone-50 transition-colors">
            Option B &middot; Sponsor Tables
          </button>
        </div>
        <div id="svg-a">{svg_a}</div>
        <div id="svg-b" style="display:none">{svg_b}</div>
      </div>

      <!-- Table cards -->
      <div class="flex-1">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-4">Tables &amp; Guests</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {table_cards}
        </div>
        {unassigned_html}
      </div>

    </div>
  </main>

  <footer class="text-center py-8 text-stone-300 text-xs tracking-wider">
    <span class="serif italic text-stone-400">Tommy &amp; Jeyan &bull; December 27, 2026</span>
  </footer>

  <script>
    function showOption(opt) {{
      document.getElementById('svg-a').style.display = opt === 'a' ? '' : 'none';
      document.getElementById('svg-b').style.display = opt === 'b' ? '' : 'none';
      var activeClass = 'bg-[#8B1A35] text-white border-[#8B1A35]';
      var inactiveClass = 'bg-white text-stone-500 border-stone-300 hover:bg-stone-50';
      if (opt === 'a') {{
        document.getElementById('btn-a').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-[#8B1A35] bg-[#8B1A35] text-white transition-colors';
        document.getElementById('btn-b').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-stone-300 text-stone-500 hover:bg-stone-50 transition-colors';
      }} else {{
        document.getElementById('btn-a').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-stone-300 text-stone-500 hover:bg-stone-50 transition-colors';
        document.getElementById('btn-b').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-[#8B1A35] bg-[#8B1A35] text-white transition-colors';
      }}
    }}
  </script>

</body>
</html>"""
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
    print(f"  Guests   : {guests['total']} total pax, {len(guests['rows'])} names")

    print("Generating HTML...")
    dashboard_html  = build_html(tasks, budget, vendors, schedule, guests)
    reception_html  = build_reception_html(guests)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(dashboard_html)

    reception_path = os.path.join(os.path.dirname(OUTPUT_PATH), "reception.html")
    with open(reception_path, "w", encoding="utf-8") as f:
        f.write(reception_html)

    print(f"Done -> {os.path.abspath(OUTPUT_PATH)}")
    print(f"Done -> {os.path.abspath(reception_path)}")


if __name__ == "__main__":
    main()
