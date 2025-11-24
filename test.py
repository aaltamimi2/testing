#!/usr/bin/env python3
"""
Basic test script with Hello World functionality
"""

def hello_world():
    """Returns a greeting message"""
    return "Hello, World!"

def add_numbers(a, b):
    """Simple function to add two numbers"""
    return a + b

def main():
    # Test hello_world function
    print("Testing hello_world():")
    result = hello_world()
    print(f"  Result: {result}")
    assert result == "Hello, World!", "hello_world test failed!"
    print("  ✓ Test passed!")

    # Test add_numbers function
    print("\nTesting add_numbers():")
    result = add_numbers(2, 3)
    print(f"  Result: 2 + 3 = {result}")
    assert result == 5, "add_numbers test failed!"
    print("  ✓ Test passed!")

    print("\n✓ All tests passed successfully!")

if __name__ == "__main__":
    main()
