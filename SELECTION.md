# Markering i StreamBIM

Velg modellag og MMI-egenskap. Klikk på en MMI-rad (inkludert Mangler MMI og Motstridende MMI), IfcProxy eller IfcBuildingElementProxy for å markere objektene i dette utvalget. Nytt klikk erstatter forrige markering. Fjern markering tømmer utvalget. Filterbytte avbryter pågående markering; klikk på en rad for å markere det nye utvalget.

Oppslag bruker IFC GlobalId og kontrollerer dokumenttilhørighet og bygg når dette er tilgjengelig. Bare markeringer bekreftet i StreamBIMs viewport telles som markert. Originalfil og publisert 3D kan ha forskjellig revisjon; objekter som ikke finnes i publisert 3D rapporteres separat. Eksempeldata kan ikke markeres.

Kjør npm test for regresjonstester av telling, modellavgrensning, dokumenttilhørighet, overlappende klikk og vertsversjoner hvor tømming av utvalg ikke gir et løst API-løfte.
