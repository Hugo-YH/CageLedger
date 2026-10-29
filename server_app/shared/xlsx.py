"""Write business data to XLSX without interpreting text as a formula."""


def set_literal_cell(cell, value):
    cell.value = value
    if isinstance(value, str):
        cell.data_type = "s"
    return cell
