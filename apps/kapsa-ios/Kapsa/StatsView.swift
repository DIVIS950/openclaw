import Charts
import SwiftUI

/// Spending tab: this month, where the money goes, the last six months.
struct StatsView: View {
    @Environment(Store.self) private var store
    @State private var monthOffset = 0

    struct MonthTotal: Identifiable {
        let id: Int
        let label: String
        let total: Double
        let isSelected: Bool
    }

    struct ShopTotal: Identifiable {
        let id: String
        let name: String
        let amount: Double
        let color: Color
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    monthPicker
                    summary
                    Button {
                        store.sheet = .logSpend(nil)
                    } label: {
                        Label(L("Zapsat útratu", "Log spending"), systemImage: "plus")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    if !shops.isEmpty {
                        SectionTitle(title: L("Kde utrácíš", "Where you spend"))
                        Panel {
                            let top = shops.first?.amount ?? 1
                            ForEach(shops.prefix(8)) { shop in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 8) {
                                        Circle().fill(shop.color).frame(width: 10, height: 10)
                                        Text(shop.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                        Spacer()
                                        Text(money(shop.amount, store.settings.currency)).font(.subheadline.weight(.semibold))
                                    }
                                    .foregroundStyle(Theme.ink)
                                    GeometryReader { geo in
                                        Capsule()
                                            .fill(Theme.grad)
                                            .frame(width: max(6, geo.size.width * shop.amount / max(top, 1)))
                                    }
                                    .frame(height: 10)
                                }
                            }
                        }
                    }
                    SectionTitle(title: L("Posledních 6 měsíců", "Last 6 months"))
                    Panel {
                        Chart(months) { m in
                            BarMark(
                                x: .value(L("Měsíc", "Month"), m.label),
                                y: .value(L("Utraceno", "Spent"), m.total)
                            )
                            .foregroundStyle(m.isSelected ? AnyShapeStyle(Theme.grad) : AnyShapeStyle(Theme.accent.opacity(0.28)))
                            .cornerRadius(6)
                        }
                        .frame(height: 190)
                    }
                    let list = store.purchases(inMonthOf: selectedMonth)
                    if !list.isEmpty {
                        SectionTitle(title: L("Nákupy", "Purchases"), count: list.count)
                        Panel {
                            ForEach(list.prefix(30)) { p in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.cardID.flatMap { store.card($0)?.name } ?? p.shop)
                                            .font(.subheadline.weight(.semibold))
                                        Text(p.date.formatted(date: .abbreviated, time: .omitted) + (p.source == .gift ? L(" · dárkovou kartou", " · gift card") : ""))
                                            .font(.caption)
                                            .foregroundStyle(Theme.ink2)
                                    }
                                    Spacer()
                                    Text(money(p.amount, store.settings.currency)).font(.subheadline.weight(.bold))
                                }
                                .foregroundStyle(Theme.ink)
                                .contextMenu {
                                    Button(L("Smazat", "Delete"), role: .destructive) {
                                        if p.source == .gift {
                                            store.undoPayment(p.id)
                                        } else {
                                            store.deletePurchase(p.id)
                                        }
                                    }
                                }
                            }
                            Text(L("Podrž nákup pro smazání.", "Press and hold a purchase to delete it."))
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(L("Přehled", "Overview"))
        }
    }

    private var selectedMonth: Date {
        Calendar.current.date(byAdding: .month, value: monthOffset, to: Date()) ?? Date()
    }

    private var monthPicker: some View {
        HStack {
            Button {
                monthOffset -= 1
            } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44)
            }
            Spacer()
            Text(selectedMonth.formatted(.dateTime.month(.wide).year()).capitalized)
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Spacer()
            Button {
                monthOffset = min(0, monthOffset + 1)
            } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44)
            }
            .disabled(monthOffset >= 0)
        }
        .font(.headline)
        .foregroundStyle(Theme.accent)
    }

    private var summary: some View {
        let list = store.purchases(inMonthOf: selectedMonth)
        let spent = list.reduce(0) { $0 + $1.amount }
        let saved = store.saved(inMonthOf: selectedMonth)
        return VStack(alignment: .leading, spacing: 12) {
            Text(L("Utraceno", "Spent")).font(.subheadline).foregroundStyle(Theme.ink2)
            Text(money(spent, store.settings.currency))
                .font(.system(size: 46, weight: .bold))
                .foregroundStyle(Theme.ink)
            HStack(spacing: 10) {
                fact(L("Ušetřeno", "Saved"), money(saved, store.settings.currency))
                fact(L("Nákupy", "Purchases"), "\(list.count)")
                fact(L("Kupóny", "Coupons"), "\(store.coupons.filter { $0.used && $0.usedAt.map { Calendar.current.isDate($0, equalTo: selectedMonth, toGranularity: .month) } == true }.count)")
            }
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(Theme.ink2)
            Text(value).font(.headline).foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line))
    }

    private var shops: [ShopTotal] {
        var totals: [String: (name: String, amount: Double, color: Color)] = [:]
        for p in store.purchases(inMonthOf: selectedMonth) {
            let card = p.cardID.flatMap { store.card($0) }
            let key = card?.id.uuidString ?? p.shop.lowercased()
            let name = card?.name ?? (p.shop.isEmpty ? L("Ostatní", "Other") : p.shop)
            let color = card?.look.dot ?? Theme.ink3
            totals[key, default: (name, 0, color)].amount += p.amount
        }
        return totals
            .map { ShopTotal(id: $0.key, name: $0.value.name, amount: $0.value.amount, color: $0.value.color) }
            .sorted { $0.amount > $1.amount }
    }

    private var months: [MonthTotal] {
        let cal = Calendar.current
        return (0..<6).reversed().map { back in
            let date = cal.date(byAdding: .month, value: monthOffset - back, to: Date()) ?? Date()
            let total = store.purchases(inMonthOf: date).reduce(0) { $0 + $1.amount }
            return MonthTotal(id: back, label: date.formatted(.dateTime.month(.abbreviated)), total: total, isSelected: back == 0)
        }
    }
}
