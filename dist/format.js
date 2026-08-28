function bullets(label, values) {
    return values.length
        ? [label, ...values.map((value) => `- ${value}`)]
        : [];
}
export function formatOption(option) {
    return [
        `${option.id}: ${option.title}`,
        option.rationale,
        ...bullets("Trade-offs:", option.tradeoffs),
        ...bullets("Risks:", option.risks),
        ...bullets("Prerequisites:", option.implementationNotes),
    ]
        .filter(Boolean)
        .join("\n");
}
export function formatDecisionResult(result) {
    const lines = [
        `${result.request.id}: ${result.outcome}`,
        result.recommendation,
        result.rationale,
    ];
    if (result.selectedOptionId) {
        const selected = result.options.find((option) => option.id === result.selectedOptionId);
        lines.push(selected
            ? `Selected direction:\n${formatOption(selected)}`
            : `Selected direction: ${result.selectedOptionId}`);
    }
    else if (result.outcome === "unresolved" && result.options.length > 0) {
        lines.push(`Available directions:\n${result.options.map(formatOption).join("\n\n")}`);
    }
    return lines.filter(Boolean).join("\n\n");
}
function formatReport(report) {
    return [
        `${report.member} (${report.confidence} confidence): ${report.recommendation}`,
        report.rationale,
        ...bullets("Risks:", report.risks),
        ...bullets("Dissent:", report.dissent),
        ...(report.options.length
            ? [
                "Suggested directions:",
                ...report.options.map((option) => formatOption(option)),
            ]
            : []),
    ]
        .filter(Boolean)
        .join("\n");
}
export function formatReviewResults(results) {
    return [
        `Read-only quorum code review completed across ${results.length} diff part${results.length === 1 ? "" : "s"}.`,
        ...results.map((result, index) => [
            `Diff part ${index + 1}: ${result.outcome}`,
            ...result.reports.map(formatReport),
        ].join("\n\n")),
        "Address every actionable finding above. Do not invoke another review in response to this message.",
    ].join("\n\n");
}
