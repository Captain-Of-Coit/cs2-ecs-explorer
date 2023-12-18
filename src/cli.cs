using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Xml;
using Formatting = Newtonsoft.Json.Formatting;

public static class Globals
{
    public const string DECOMPILED_CODE_PATH = @"G:\projects\exported-cs2-1.0.18f1\Game\Game\Game";
    public const string EXPORT_COMPONENTS_PATH = @"data/Components.json";
    public const string EXPORT_SYSTEMS_PATH = @"data/Systems.json";
    public const bool SKIP_DEBUG_SYSTEMS = true;
}

// Represents a found property within a Component
public struct ComponentProperty
{
    public string visibility;
    public string type;
    public string name;
}

// Represents a found Component (implements IComponentData)
public struct FoundComponent
{
    public string name;
    public List<ComponentProperty> properties;
}

// Represents a found System (implements GameBaseSystem)
public struct FoundSystem
{
    public string name;
    public List<string> componentTypes;
    public List<string> uses_system;
}

// Does the actual parsing of source code and formats it
public class Parser
{
    private static Dictionary<string, List<string>> componentToSystemsMap = new Dictionary<string, List<string>>();
    private static Dictionary<string, List<string>> systemToSystemsMap = new Dictionary<string, List<string>>();


    private Dictionary<string, string> CreateTypeNameMapping(string path)
    {
        string[] allFiles = Directory.GetFiles(path, "*.cs", SearchOption.AllDirectories);
        var nameMapping = new Dictionary<string, string>();

        foreach (var file in allFiles)
        {
            var code = File.ReadAllText(file);
            var syntaxTree = CSharpSyntaxTree.ParseText(code);
            var root = syntaxTree.GetRoot();
            var typeDeclarations = root.DescendantNodes().OfType<TypeDeclarationSyntax>();

            foreach (var typeDeclaration in typeDeclarations)
            {
                var fullName = GetFullName(typeDeclaration);
                var shortName = typeDeclaration.Identifier.ValueText;
                if (!nameMapping.ContainsKey(shortName))
                {
                    nameMapping[shortName] = fullName;
                }
            }
        }

        return nameMapping;
    }


    private string GetFullName(BaseTypeDeclarationSyntax typeDeclaration)
    {
        var namespaceDeclaration = typeDeclaration.Ancestors().OfType<NamespaceDeclarationSyntax>().FirstOrDefault();
        return (namespaceDeclaration != null ? namespaceDeclaration.Name + "." : string.Empty) + typeDeclaration.Identifier.ValueText;
    }

    public List<FoundComponent> FindComponents(string path)
    {
        string[] allFiles = Directory.GetFiles(path, "*.cs", SearchOption.AllDirectories);
        ConcurrentBag<FoundComponent> classFields = new ConcurrentBag<FoundComponent>();

        Parallel.ForEach(allFiles, file =>
        {
            var code = File.ReadAllText(file);
            var syntaxTree = CSharpSyntaxTree.ParseText(code);
            var root = syntaxTree.GetRoot();
            var typeDeclarations = root.DescendantNodes().OfType<TypeDeclarationSyntax>();

            foreach (var typeDeclaration in typeDeclarations)
            {
                var baseTypes = typeDeclaration.BaseList?.Types.Select(bt => bt.ToString());
                if (baseTypes != null && baseTypes.Contains("IComponentData"))
                {
                    var fields = typeDeclaration.DescendantNodes()
                                                .OfType<FieldDeclarationSyntax>()
                                                .Select(f =>
                                                {
                                                    var prop = new ComponentProperty
                                                    {
                                                        visibility = f.Modifiers.ToString(),
                                                        type = f.Declaration.Type.ToString(),
                                                        name = string.Join(", ", f.Declaration.Variables.Select(v => v.Identifier.ValueText)),
                                                    };
                                                    return prop;
                                                })
                                                .ToList();

                    var found_component = new FoundComponent
                    {
                        name = GetFullName(typeDeclaration),
                        properties = fields,
                    };
                    classFields.Add(found_component);
                }
            }
        });

        return classFields.ToList();
    }

    public List<FoundSystem> FindSystems(string path)
    {
        string[] allFiles = Directory.GetFiles(path, "*.cs", SearchOption.AllDirectories);
        ConcurrentBag<FoundSystem> classFields = new ConcurrentBag<FoundSystem>();
        var typeNameMapping = CreateTypeNameMapping(path);

        // Have race-conditions with this for some reason, probably because concurrent mutations to the type mappings
        //Parallel.ForEach(allFiles, file => {
        foreach (var file in allFiles)
        {
            var code = File.ReadAllText(file);
            var syntaxTree = CSharpSyntaxTree.ParseText(code);
            var root = syntaxTree.GetRoot();
            var typeDeclarations = root.DescendantNodes().OfType<TypeDeclarationSyntax>();

            foreach (var typeDeclaration in typeDeclarations)
            {
                var name = GetFullName(typeDeclaration);

                // Skip processing if the system is Debug as it's connected with a lot of things
                if (Globals.SKIP_DEBUG_SYSTEMS && name.Contains("Debug")) continue;

                var baseTypes = typeDeclaration.BaseList?.Types.Select(bt => bt.ToString());
                if (baseTypes != null && baseTypes.Contains("GameSystemBase"))
                {
                    var foundSystem = new FoundSystem
                    {
                        name = name,
                        componentTypes = new List<string>(),
                        uses_system = new List<string>(),
                    };

                    var typeHandle = typeDeclaration.DescendantNodes()
                                                     .OfType<StructDeclarationSyntax>()
                                                     .FirstOrDefault(s => s.Identifier.ValueText == "TypeHandle");


                    if (typeHandle != null)
                    {
                        var handleFields = typeHandle.Members
                                                      .OfType<FieldDeclarationSyntax>()
                                                      .Where(f => f.Declaration.Type is GenericNameSyntax genericType &&
                                                                  (genericType.ToString().Contains("ComponentTypeHandle") ||
                                                                   genericType.ToString().Contains("ComponentLookup")));

                        foreach (var field in handleFields)
                        {
                            var genericType = field.Declaration.Type as GenericNameSyntax;
                            if (genericType != null)
                            {
                                var typeName = genericType.TypeArgumentList.Arguments.FirstOrDefault()?.ToString();
                                if (!string.IsNullOrEmpty(typeName) && typeNameMapping.TryGetValue(typeName, out var fullName))
                                {
                                    foundSystem.componentTypes.Add(fullName);
                                }
                            }
                        }
                    }

                    var onCreateMethod = typeDeclaration.DescendantNodes()
                                                        .OfType<MethodDeclarationSyntax>()
                                                        .FirstOrDefault(m => m.Identifier.ValueText == "OnCreate");

                    if (onCreateMethod != null)
                    {
                        var invocations = onCreateMethod.DescendantNodes()
                                                        .OfType<InvocationExpressionSyntax>();

                        foreach (var invocation in invocations)
                        {
                            if (invocation.Expression is MemberAccessExpressionSyntax memberAccess &&
                                memberAccess.Name.Identifier.ValueText == "GetOrCreateSystemManaged")
                            {
                                var genericName = invocation.Expression.DescendantNodesAndSelf()
                                                                       .OfType<GenericNameSyntax>()
                                                                       .FirstOrDefault();
                                if (genericName != null)
                                {
                                    var typeName = genericName.TypeArgumentList.Arguments.FirstOrDefault()?.ToString();
                                    if (!string.IsNullOrEmpty(typeName) && typeNameMapping.TryGetValue(typeName, out var fullName))
                                    {
                                        foundSystem.uses_system.Add(fullName);
                                    }
                                }
                            }
                        }
                    }

                    foreach (var component in foundSystem.componentTypes)
                    {
                        if (!componentToSystemsMap.ContainsKey(component))
                        {
                            componentToSystemsMap[component] = new List<string>();
                        }
                        componentToSystemsMap[component].Add(foundSystem.name);
                    }

                    foreach (var usedSystem in foundSystem.uses_system)
                    {
                        if (!systemToSystemsMap.ContainsKey(usedSystem))
                        {
                            systemToSystemsMap[usedSystem] = new List<string>();
                        }
                        systemToSystemsMap[usedSystem].Add(foundSystem.name);
                    }

                    classFields.Add(foundSystem);
                }
            }
        }

        return classFields.ToList();
    }

    public void ExportToJson<T>(List<T> items, string filePath, Func<T, string> keySelector, Func<T, object> additionalData = null)
    {
        var dictionary = new Dictionary<string, object>();
        foreach (var item in items)
        {
            var key = keySelector(item);

            // Convert item to a dictionary
            var itemDict = JsonConvert.DeserializeObject<Dictionary<string, object>>(JsonConvert.SerializeObject(item));
            if (additionalData != null)
            {
                var additionalDataValue = additionalData != null ? additionalData(item) : null;
                if (additionalDataValue != null)
                {
                    itemDict.Add("used_in_system", additionalDataValue);
                }
            }

            dictionary.Add(key, itemDict);
        }
        File.WriteAllText(filePath, JsonConvert.SerializeObject(dictionary, Formatting.Indented));
    }

    static void Main(string[] args)
    {
        var finder = new Parser();

        Console.WriteLine("Finding all components...");
        var components = finder.FindComponents(Globals.DECOMPILED_CODE_PATH);

        foreach (var component in components)
        {
            Console.WriteLine($"Component: {component.name}");
            foreach (var property in component.properties)
            {
                Console.WriteLine($"    Property: {property.name} => {property.type}");
            }
        }

        Console.WriteLine("Finding all systems...");
        var systems = finder.FindSystems(Globals.DECOMPILED_CODE_PATH);

        foreach (var system in systems)
        {
            Console.WriteLine($"System: {system.name}");
            foreach (var component in system.componentTypes)
            {
                Console.WriteLine($"    Uses Component: {component}");
            }
            foreach (var system2 in system.uses_system)
            {
                Console.WriteLine($"    Uses System: {system2}");
            }
        }

        Console.WriteLine($"Found {components.Count()} Components");
        Console.WriteLine($"Found {systems.Count()} Systems");

        Console.WriteLine("Exporting...");

        finder.ExportToJson(
            components,
            Globals.EXPORT_COMPONENTS_PATH,
            c => c.name,
            c => componentToSystemsMap.TryGetValue(c.name, out var backlinks) ? backlinks : new List<string>()
        );
        Console.WriteLine($"Exported {Globals.EXPORT_COMPONENTS_PATH}");

        finder.ExportToJson(
            systems,
            Globals.EXPORT_SYSTEMS_PATH,
            s => s.name,
            s => systemToSystemsMap.TryGetValue(s.name, out var usedBy) ? usedBy : new List<string>()
        );
        Console.WriteLine($"Exported {Globals.EXPORT_SYSTEMS_PATH}");
    }
}
